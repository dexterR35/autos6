-- Audit fixes (19 November 2026).
--   1. Stripe minimum charge per currency (RON needs at least 2.00 lei).
--   2. Disputes (chargebacks) take the payment out of every total until the dispute is
--      won; a lost dispute stays out. Parts reopen automatically when that drops them
--      under their goal.
--   3. A monthly checkout paid by bank debit stays pending until the money arrives.
--   4. The "manage monthly support" link from a checkout works for 2 days only.
--   5. Currency can't change while a checkout in the old currency may still complete.

-- ================================================================ 1. minimum amounts
-- Stripe's minimum charge per currency, or the site minimum of 1.00 when higher.
create or replace function public.minimum_charge_cents(p_currency text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case lower(p_currency) when 'ron' then 200 else 100 end;
$$;
grant execute on function public.minimum_charge_cents(text) to anon, authenticated, service_role;

create or replace function public.enforce_minimum_charge()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_min integer := public.minimum_charge_cents(new.currency);
begin
  -- Only new checkouts; recorded payments (paid invoices) are kept whatever their size.
  if new.status = 'pending' and new.amount_cents < v_min then
    raise exception 'below_minimum:%:%', v_min, lower(new.currency) using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_minimum_charge() from public, anon, authenticated;
create trigger donations_minimum_charge before insert on public.donations
  for each row execute function public.enforce_minimum_charge();
create trigger recurring_minimum_charge before insert on public.recurring_supports
  for each row execute function public.enforce_minimum_charge();

-- ================================================================ 2. disputes
alter table public.donations
  add column dispute_status text check (dispute_status in ('open', 'won', 'lost')),
  add column review_before_dispute boolean;

create or replace function public.process_dispute_event(
  p_event_id text,
  p_type text,
  p_livemode boolean,
  p_payment_intent_id text,
  p_dispute_status text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.donations%rowtype;
  v_result text := 'ignored';
begin
  insert into public.stripe_events (event_id, type, livemode) values (p_event_id, p_type, coalesce(p_livemode, false))
  on conflict (event_id) do nothing;
  if not found then return 'duplicate'; end if;

  select * into d from public.donations where stripe_payment_intent_id = p_payment_intent_id for update;
  if d.id is not null then
    if p_type = 'charge.dispute.created' or (p_type = 'charge.dispute.updated' and d.dispute_status is null) then
      update public.donations
         set review_before_dispute = case when dispute_status is null then needs_review else review_before_dispute end,
             dispute_status = 'open', needs_review = true
       where id = d.id;
      v_result := 'applied';
    elsif p_type in ('charge.dispute.closed', 'charge.dispute.funds_reinstated') then
      if p_dispute_status = 'lost' then
        update public.donations set dispute_status = 'lost', needs_review = true where id = d.id;
      elsif p_dispute_status in ('won', 'warning_closed', 'prevented') or p_type = 'charge.dispute.funds_reinstated' then
        update public.donations
           set dispute_status = 'won', needs_review = coalesce(review_before_dispute, false)
         where id = d.id;  -- also after a lost dispute is won on appeal
      end if;
      v_result := 'applied';
    end if;
  end if;
  update public.stripe_events set donation_id = d.id, result = v_result where event_id = p_event_id;
  return v_result;
end;
$$;
revoke all on function public.process_dispute_event(text, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.process_dispute_event(text, text, boolean, text, text) to service_role;

-- ================================================================ 3. bank-debit monthly checkouts
create or replace function public.process_recurring_event(
  p_event_id text,
  p_type text,
  p_livemode boolean,
  p_recurring_id uuid,
  p_session_id text,
  p_subscription_id text,
  p_customer_id text,
  p_subscription_status text,
  p_invoice_id text,
  p_payment_intent_id text,
  p_amount_paid bigint,
  p_currency text,
  p_email text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.recurring_supports%rowtype;
  v_project public.projects%rowtype;
  v_part_open boolean;
  v_result text := 'ignored';
begin
  insert into public.stripe_events (event_id, type, livemode) values (p_event_id, p_type, coalesce(p_livemode, false))
  on conflict (event_id) do nothing;
  if not found then return 'duplicate'; end if;

  if p_recurring_id is not null then
    select * into r from public.recurring_supports where id = p_recurring_id for update;
  end if;
  if r.id is null and p_subscription_id is not null then
    select * into r from public.recurring_supports where stripe_subscription_id = p_subscription_id for update;
  end if;
  if r.id is null and p_session_id is not null then
    select * into r from public.recurring_supports where stripe_checkout_session_id = p_session_id for update;
  end if;
  if r.id is null then
    -- Not one of ours yet (or arrived before checkout was recorded): Stripe retries.
    raise exception 'recurring_not_found' using errcode = 'P0002';
  end if;
  if r.stripe_subscription_id is not null and p_subscription_id is not null and r.stripe_subscription_id <> p_subscription_id then
    raise exception 'recurring_mismatch' using errcode = '23505';
  end if;

  if p_type = 'checkout.session.completed' then
    -- For sessions p_subscription_status carries the session's payment_status: a bank
    -- debit completes Checkout as 'unpaid' and stays pending until invoice.paid.
    update public.recurring_supports
       set status = case when status = 'pending' and coalesce(p_subscription_status, 'paid') in ('paid', 'no_payment_required') then 'active' else status end,
           stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id),
           stripe_subscription_id = coalesce(stripe_subscription_id, p_subscription_id),
           stripe_customer_id = coalesce(stripe_customer_id, p_customer_id),
           donor_email = coalesce(donor_email, p_email)
     where id = r.id;
    v_result := 'applied';
  elsif p_type = 'checkout.session.expired' then
    update public.recurring_supports set status = 'expired' where id = r.id and status = 'pending';
    v_result := 'applied';
  elsif p_type = 'invoice.paid' then
    if p_invoice_id is null or p_amount_paid is null or p_amount_paid <= 0 then return 'ignored'; end if;
    select * into v_project from public.projects where id = r.project_id;
    select exists (select 1 from public.parts where id = r.part_id and status in ('needed', 'upgrade')) into v_part_open;
    insert into public.donations (project_id, part_id, attempt_id, amount_cents, currency, status, paid_at, donor_email,
      display_name, is_public, notify_updates, needs_review, stripe_payment_intent_id, stripe_invoice_id, recurring_id,
      terms_version, privacy_version, terms_accepted_at)
    values (r.project_id, case when v_part_open then r.part_id end, gen_random_uuid(), p_amount_paid, lower(coalesce(p_currency, 'invalid')),
      'paid', now(), coalesce(p_email, r.donor_email), r.display_name, r.is_public, r.notify_updates,
      -- Anything other than the agreed monthly amount in the project's currency waits for review.
      (p_amount_paid <> r.amount_cents or lower(coalesce(p_currency, '')) <> r.currency or r.currency <> v_project.currency),
      p_payment_intent_id, p_invoice_id, r.id, r.terms_version, r.terms_version, r.created_at)
    on conflict (stripe_invoice_id) do nothing;
    update public.recurring_supports
       set status = 'active',
           stripe_subscription_id = coalesce(stripe_subscription_id, p_subscription_id),
           stripe_customer_id = coalesce(stripe_customer_id, p_customer_id),
           donor_email = coalesce(donor_email, p_email)
     where id = r.id and status in ('pending', 'active', 'past_due');
    v_result := 'applied';
  elsif p_type = 'invoice.payment_failed' then
    update public.recurring_supports set status = 'past_due' where id = r.id and status in ('pending', 'active');
    v_result := 'applied';
  elsif p_type in ('customer.subscription.updated', 'customer.subscription.deleted') then
    update public.recurring_supports
       set status = case
             when p_type = 'customer.subscription.deleted' or p_subscription_status = 'canceled' then 'canceled'
             when p_subscription_status in ('past_due', 'unpaid', 'paused') then 'past_due'
             when p_subscription_status = 'incomplete_expired' then 'expired'
             when p_subscription_status in ('active', 'trialing') then 'active'
             else status end,
           canceled_at = case when p_type = 'customer.subscription.deleted' or p_subscription_status = 'canceled' then coalesce(canceled_at, now()) else canceled_at end,
           stripe_subscription_id = coalesce(stripe_subscription_id, p_subscription_id)
     where id = r.id;
    v_result := 'applied';
  end if;
  update public.stripe_events set result = v_result where event_id = p_event_id;
  return v_result;
end;
$$;

-- ================================================================ 4. manage link window
create or replace function public.get_recurring_portal_customer(p_session_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.stripe_customer_id from public.recurring_supports r
   where r.stripe_checkout_session_id = p_session_id and r.created_at > now() - interval '2 days';
$$;
revoke all on function public.get_recurring_portal_customer(text) from public, anon, authenticated;
grant execute on function public.get_recurring_portal_customer(text) to service_role;

-- ================================================================ 5. currency lock
create or replace function public.set_project_currency(p_project_id uuid, p_currency text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_project_admin(p_project_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_currency is null or p_currency not in ('usd', 'eur', 'ron', 'gbp') then
    raise exception 'invalid_currency' using errcode = '22023';
  end if;
  -- Paid money, payments still processing, and checkouts that may still complete
  -- (Stripe Checkout sessions last at most 24 hours) all pin the currency.
  if exists (select 1 from public.donations where project_id = p_project_id and currency <> p_currency
               and (status in ('paid', 'processing') or (status = 'pending' and created_at > now() - interval '25 hours')))
     or exists (select 1 from public.recurring_supports where project_id = p_project_id and currency <> p_currency
               and (status in ('active', 'past_due') or (status = 'pending' and created_at > now() - interval '25 hours'))) then
    raise exception 'currency_locked' using errcode = '22023', hint = 'Payments or open checkouts exist in the current currency.';
  end if;
  update public.projects set currency = p_currency where id = p_project_id;
end;
$$;
revoke all on function public.set_project_currency(uuid, text) from public, anon;
grant execute on function public.set_project_currency(uuid, text) to authenticated;

-- ================================================================ 6. finishing a part at the currency minimum
create or replace function public.create_pending_donation(
  p_attempt_id uuid,
  p_project_slug text,
  p_part_slug text,
  p_amount_cents bigint,
  p_display_name text,
  p_is_public boolean
)
returns table (
  donation_id uuid, project_id uuid, currency text, part_slug text, part_name text,
  amount_cents bigint, stripe_checkout_session_id text, status text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_project public.projects%rowtype;
  v_part public.parts%rowtype;
  v_existing public.donations%rowtype;
  v_remaining bigint;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  select * into v_project from public.projects where slug = p_project_slug and is_published;
  if not found then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;

  if p_part_slug is not null then
    select * into v_part from public.parts where project_id = v_project.id and slug = p_part_slug for update;
    if not found then
      raise exception 'part_not_found' using errcode = 'P0002';
    end if;
    if not exists (select 1 from public.donations d where d.attempt_id = p_attempt_id) then
      if v_part.status not in ('needed', 'upgrade') then
        raise exception 'part_closed' using errcode = '22023';
      end if;
      -- With less than the minimum charge left, one minimum contribution may finish the part.
      v_remaining := greatest(v_part.estimate_cents - public.part_raised_cents(v_part.id), 0);
      if p_amount_cents > greatest(v_remaining, public.minimum_charge_cents(v_project.currency)) then
        raise exception 'amount_exceeds_remaining:%', v_remaining using errcode = '22023';
      end if;
    end if;
  end if;

  insert into public.donations (project_id, part_id, attempt_id, amount_cents, currency, display_name, is_public)
  values (v_project.id, v_part.id, p_attempt_id, p_amount_cents, v_project.currency,
          nullif(btrim(p_display_name), ''), coalesce(p_is_public, false))
  on conflict (attempt_id) do nothing;

  select * into v_existing from public.donations d where d.attempt_id = p_attempt_id;
  if v_existing.project_id <> v_project.id
     or v_existing.amount_cents <> p_amount_cents
     or v_existing.part_id is distinct from v_part.id then
    raise exception 'attempt_mismatch' using errcode = '23505';
  end if;

  return query select v_existing.id, v_existing.project_id, v_existing.currency, v_part.slug, v_part.name,
    v_existing.amount_cents, v_existing.stripe_checkout_session_id, v_existing.status;
end;
$$;
revoke execute on function public.create_pending_donation(uuid, text, text, bigint, text, boolean) from public, anon, authenticated;
grant execute on function public.create_pending_donation(uuid, text, text, bigint, text, boolean) to service_role;
