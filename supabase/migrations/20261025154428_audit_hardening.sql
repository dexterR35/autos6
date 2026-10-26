-- Audit follow-up, 25 October 2026.
-- 1. Community readers no longer see the author's account id.
-- 2. The supporter wall never folds an unnamed donation into someone's named row.
-- 3. Subscriber emails are batched: edits inside a short window update one queued email,
--    and a restoration update is emailed once, even if it is unpublished and republished.
-- 4. Refund totals are replaced with Stripe's current recount (failed refunds return money).

-- ---------------------------------------------------------------- 1. community authors
-- author_id is still used by the row policy (members see their own pending posts) but is
-- no longer readable through the Data API, so posts can't be linked by account.
revoke select on public.community_posts from anon, authenticated;
grant select (id, project_id, parent_id, display_name, category, title, body, status, created_at)
  on public.community_posts to anon, authenticated;

-- ---------------------------------------------------------------- 2. supporter wall
-- Named donations from the same private email still combine under the newest name.
-- Unnamed ones ("Anonymous", or a name hidden because it looks like an email) stay as
-- separate rows, so choosing not to be named is never undone by a later donation.
create or replace function public.get_garage_supporters(
  p_slug text,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table(display_name text, donation_count bigint, amount_cents bigint)
language sql stable security definer set search_path = '' as $$
  with eligible as (
    select
      nullif(btrim(d.display_name), '') as name,
      d.donor_email,
      d.amount_cents - d.refunded_cents as net_cents,
      d.paid_at,
      d.id
    from public.donations d
    join public.projects p on p.id = d.project_id
    where p.slug = p_slug and p.is_published
      and d.status = 'paid' and d.is_public and not d.needs_review
      and d.currency = p.currency and d.refunded_cents < d.amount_cents
  ), labelled as (
    select
      e.*,
      case when e.name is null or lower(e.name) in ('anonymous', 'supporter') then 'Anonymous'
        when position('@' in e.name) > 0 then 'Supporter'
        else e.name end as public_name,
      e.name is null or lower(e.name) in ('anonymous', 'supporter') or position('@' in e.name) > 0 as unnamed
    from eligible e
  ), keyed as (
    select
      l.*,
      case when l.unnamed then 'donation:' || l.id::text
        else coalesce('email:' || nullif(lower(btrim(l.donor_email)), ''), 'donation:' || l.id::text) end as supporter_key
    from labelled l
  ), supporters as (
    select
      k.supporter_key,
      (array_agg(k.public_name order by k.paid_at desc nulls last, k.id desc))[1] as public_name,
      count(*) as contribution_count,
      sum(k.net_cents)::bigint as total_cents,
      max(k.paid_at) as latest_at
    from keyed k
    group by k.supporter_key
  )
  select s.public_name, s.contribution_count, s.total_cents
  from supporters s
  order by s.total_cents desc, s.latest_at desc nulls last, s.supporter_key
  limit least(greatest(coalesce(p_limit, 100), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ---------------------------------------------------------------- 3. batched emails
-- Queued update emails wait this long, so a typo fix or a run of edits sends one email.
-- payload.source identifies what the email is about: 'part:<id>' or 'update:<id>'.
create index email_jobs_pending_source_idx on public.email_jobs ((payload->>'source')) where state = 'pending';

create or replace function public.queue_project_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_delay constant interval := interval '10 minutes';
  v_title text; v_body text; v_part uuid; v_path text; v_source text; v_payload jsonb;
begin
  if tg_op = 'DELETE' then
    -- Never send an email about something that no longer exists.
    update public.email_jobs set state = 'cancelled'
      where state = 'pending'
        and payload->>'source' = (case when tg_table_name = 'parts' then 'part:' else 'update:' end) || old.id::text;
    return old;
  end if;

  if tg_table_name = 'parts' then
    if tg_op = 'UPDATE' and (new.name,new.estimate_cents,new.status,new.description,new.priority,new.condition,new.thumbnail_url)
      is not distinct from (old.name,old.estimate_cents,old.status,old.description,old.priority,old.condition,old.thumbnail_url) then return new; end if;
    v_part := new.id;
    v_source := 'part:' || new.id::text;
    v_title := 'Part update: ' || new.name;
    v_body := new.name || ' · ' || new.status || ' · Goal $' || to_char(new.estimate_cents / 100.0, 'FM999999990.00') || E'\n' || coalesce(new.description, '');
    v_path := '/parts';
  else
    v_source := 'update:' || new.id::text;
    if new.published_at is null or new.published_at > now() then
      -- Unpublished before delivery: never email a draft.
      update public.email_jobs set state = 'cancelled' where state = 'pending' and payload->>'source' = v_source;
      return new;
    end if;
    if tg_op = 'UPDATE' and (new.title,new.body,new.published_at) is not distinct from (old.title,old.body,old.published_at) then return new; end if;
    v_title := new.title;
    v_body := left(new.body, 1500);
    v_path := '/progress';
  end if;
  if not exists (select 1 from public.projects where id = new.project_id and is_published) then return new; end if;
  v_payload := jsonb_build_object('title', v_title, 'body', v_body, 'path', v_path, 'source', v_source);

  -- An edit while an email is still queued rewrites that email and restarts its wait.
  update public.email_jobs
     set payload = v_payload, available_at = greatest(available_at, now() + v_delay)
   where state = 'pending' and payload->>'source' = v_source;

  if tg_table_name = 'parts' then
    insert into public.email_jobs (subscriber_id, kind, payload, unique_key, available_at)
      select s.id, 'update', v_payload, v_source || ':' || gen_random_uuid()::text || ':' || s.id::text, now() + v_delay
      from public.subscribers s
      where s.project_id = new.project_id and s.status = 'active'
        and (s.part_id is null or s.part_id = v_part)
        and not exists (
          select 1 from public.email_jobs j
          where j.subscriber_id = s.id and j.state = 'pending' and j.payload->>'source' = v_source
        );
  elsif tg_op = 'INSERT' or old.published_at is null or old.published_at > now() then
    -- One email per restoration update and subscriber. Republishing revives an email that
    -- was cancelled before any delivery attempt, and never resends one already sent.
    insert into public.email_jobs as j (subscriber_id, kind, payload, unique_key, available_at)
      select s.id, 'update', v_payload, v_source || ':' || s.id::text, now() + v_delay
      from public.subscribers s
      where s.project_id = new.project_id and s.status = 'active'
    on conflict (unique_key) do update
      set payload = excluded.payload, available_at = excluded.available_at, state = 'pending', created_at = now()
      where j.state = 'cancelled' and j.attempts = 0;
  end if;
  return new;
end;
$$;
revoke all on function public.queue_project_notification() from public, anon, authenticated;

create trigger notify_part_delete after delete on public.parts
  for each row execute function public.queue_project_notification();
create trigger notify_project_update_delete after delete on public.restoration_updates
  for each row execute function public.queue_project_notification();

-- ---------------------------------------------------------------- 4. refund recount
-- Same function as before except the refund branch. For charge.refunded, refund.failed
-- and refund.updated the API passes Stripe's current total of non-failed, non-cancelled
-- refunds, recounted while processing the event. Storing that value (rather than the
-- largest one seen) lets a failed refund put the money back into the funding totals.
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

  elsif p_type in ('charge.refunded', 'refund.failed', 'refund.updated') then
    select * into d from public.donations where stripe_payment_intent_id = p_payment_intent_id for update;
    if d.id is null and p_donation_id is not null then
      select * into d from public.donations where id = p_donation_id for update;
      if d.id is not null and d.stripe_payment_intent_id is null then
        -- Refund arrived before the payment was recorded: retry later.
        raise exception 'donation_not_found' using errcode = 'P0002';
      end if;
    end if;
    if d.id is not null and p_amount_refunded is not null then
      update public.donations
         set refunded_cents = least(greatest(p_amount_refunded, 0), amount_cents)
       where id = d.id;
      v_result := 'applied';
    end if;
  end if;

  update public.stripe_events set donation_id = d.id, result = v_result where event_id = p_event_id;
  return v_result;
end;
$$;
revoke execute on function public.process_stripe_event(text, text, boolean, text, text, text, bigint, text, text, bigint, uuid) from public, anon, authenticated;
grant execute on function public.process_stripe_event(text, text, boolean, text, text, text, bigint, text, text, bigint, uuid) to service_role;
