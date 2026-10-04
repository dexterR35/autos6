-- Server-only payment functions (service role). Each runs in a single transaction, so a
-- webhook retry can never count a payment twice and a failure rolls everything back.

-- ---------------------------------------------------------------- create pending donation
-- Idempotent per attempt_id: a retried request returns the same donation row.
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
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  select * into v_project from public.projects where slug = p_project_slug and is_published;
  if not found then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;

  if p_part_slug is not null then
    select * into v_part from public.parts where project_id = v_project.id and slug = p_part_slug;
    if not found then
      raise exception 'part_not_found' using errcode = 'P0002';
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

-- ---------------------------------------------------------------- link checkout session
create or replace function public.attach_checkout_session(p_donation_id uuid, p_session_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.donations
     set stripe_checkout_session_id = p_session_id
   where id = p_donation_id
     and (stripe_checkout_session_id is null or stripe_checkout_session_id = p_session_id);
  return found;
end;
$$;

-- ---------------------------------------------------------------- webhook processing
-- Returns: 'applied' | 'duplicate' | 'ignored' | 'mismatch'.
-- Raises 'donation_not_found' (P0002) when a donation we created is not visible yet, so
-- the transaction (including the event row) rolls back and Stripe retries later.
-- Status only moves forward: pending → processing → paid | failed, pending → expired.
create or replace function public.process_stripe_event(
  p_event_id text,
  p_type text,
  p_livemode boolean,
  p_session_id text,
  p_payment_intent_id text,
  p_payment_status text,
  p_amount_total bigint,
  p_currency text,
  p_donor_email text,
  p_amount_refunded bigint,
  p_donation_id uuid
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
  insert into public.stripe_events (event_id, type, livemode)
  values (p_event_id, p_type, coalesce(p_livemode, false))
  on conflict (event_id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  if p_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded',
                'checkout.session.async_payment_failed', 'checkout.session.expired') then
    select * into d from public.donations where stripe_checkout_session_id = p_session_id for update;
    if not found and p_donation_id is not null then
      -- Webhook may beat attach_checkout_session; fall back to the id in session metadata.
      select * into d from public.donations
       where id = p_donation_id and (stripe_checkout_session_id is null or stripe_checkout_session_id = p_session_id)
       for update;
      if found and d.stripe_checkout_session_id is null then
        update public.donations set stripe_checkout_session_id = p_session_id where id = d.id;
      end if;
    end if;
    if d.id is null then
      raise exception 'donation_not_found' using errcode = 'P0002';
    end if;

    if p_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded')
       and p_amount_total is not null
       and (p_amount_total <> d.amount_cents or lower(p_currency) <> d.currency) then
      update public.donations
         set needs_review = true,
             stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id)
       where id = d.id;
      v_result := 'mismatch';
    elsif p_type = 'checkout.session.completed' then
      if p_payment_status = 'paid' and d.status in ('pending', 'processing', 'expired') then
        update public.donations
           set status = 'paid', paid_at = coalesce(paid_at, now()),
               stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id),
               donor_email = coalesce(donor_email, p_donor_email)
         where id = d.id;
        v_result := 'applied';
      elsif p_payment_status = 'unpaid' and d.status = 'pending' then
        -- Delayed payment method (e.g. bank debit): wait for async_payment_succeeded/failed.
        update public.donations
           set status = 'processing',
               stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id),
               donor_email = coalesce(donor_email, p_donor_email)
         where id = d.id;
        v_result := 'applied';
      end if;
    elsif p_type = 'checkout.session.async_payment_succeeded' then
      if d.status in ('pending', 'processing') then
        update public.donations
           set status = 'paid', paid_at = coalesce(paid_at, now()),
               stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id),
               donor_email = coalesce(donor_email, p_donor_email)
         where id = d.id;
        v_result := 'applied';
      end if;
    elsif p_type = 'checkout.session.async_payment_failed' then
      if d.status in ('pending', 'processing') then
        update public.donations set status = 'failed' where id = d.id;
        v_result := 'applied';
      end if;
    elsif p_type = 'checkout.session.expired' then
      if d.status = 'pending' then
        update public.donations set status = 'expired' where id = d.id;
        v_result := 'applied';
      end if;
    end if;

  elsif p_type = 'charge.refunded' then
    select * into d from public.donations where stripe_payment_intent_id = p_payment_intent_id for update;
    if d.id is null and p_donation_id is not null then
      select * into d from public.donations where id = p_donation_id for update;
      if d.id is not null and d.stripe_payment_intent_id is null then
        -- Refund arrived before the payment was recorded: retry later.
        raise exception 'donation_not_found' using errcode = 'P0002';
      end if;
    end if;
    if d.id is not null then
      -- amount_refunded on a charge is cumulative, so keep the maximum (order-independent).
      update public.donations
         set refunded_cents = greatest(refunded_cents, least(coalesce(p_amount_refunded, 0), amount_cents))
       where id = d.id;
      v_result := 'applied';
    end if;
  end if;

  update public.stripe_events set donation_id = d.id, result = v_result where event_id = p_event_id;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------- scoped status lookup
-- Looked up by the unguessable Checkout Session id only; returns no personal data.
create or replace function public.get_donation_status(p_session_id text)
returns table (status text, amount_cents bigint, refunded_cents bigint, currency text, part_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.status, d.amount_cents, d.refunded_cents, d.currency, pt.name
    from public.donations d
    left join public.parts pt on pt.id = d.part_id
   where d.stripe_checkout_session_id = p_session_id;
$$;

revoke execute on function public.create_pending_donation(uuid, text, text, bigint, text, boolean) from public, anon, authenticated;
revoke execute on function public.attach_checkout_session(uuid, text) from public, anon, authenticated;
revoke execute on function public.process_stripe_event(text, text, boolean, text, text, text, bigint, text, text, bigint, uuid) from public, anon, authenticated;
revoke execute on function public.get_donation_status(text) from public, anon, authenticated;
grant execute on function public.create_pending_donation(uuid, text, text, bigint, text, boolean) to service_role;
grant execute on function public.attach_checkout_session(uuid, text) to service_role;
grant execute on function public.process_stripe_event(text, text, boolean, text, text, text, bigint, text, text, bigint, uuid) to service_role;
grant execute on function public.get_donation_status(text) to service_role;
