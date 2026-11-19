-- Supporter features (19 November 2026):
--   1. part extras: "next up" queue, car placement for installed models, before/after
--      photos, receipt photo, one-transaction reordering
--   2. project currency (USD / EUR / RON / GBP), changeable until money arrives
--   3. donors may ask for update emails at checkout
--   4. public "funded by" names per part
--   5. supporter votes between part options, owner turns the winner into a part card
--   6. monthly recurring support through Stripe subscriptions (each paid invoice = donation)
--   7. owner daily digest
--   8. update emails show the project's currency and readable stage names

-- ================================================================ 1. part extras
alter table public.parts
  add column is_next_up boolean not null default false,
  add column car_placement text not null default 'fit' check (car_placement in ('off', 'fit', 'car')),
  add column before_image_url text check (before_image_url is null or (char_length(before_image_url) <= 500 and before_image_url ~ '^(https://|/[^/])')),
  add column after_image_url text check (after_image_url is null or (char_length(after_image_url) <= 500 and after_image_url ~ '^(https://|/[^/])')),
  add column receipt_url text check (receipt_url is null or (char_length(receipt_url) <= 500 and receipt_url ~ '^(https://|/[^/])'));

-- At most three parts are "next up" at once, and only while they still need money.
create or replace function public.parts_next_up_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_next_up and new.status not in ('needed', 'upgrade') then
    new.is_next_up := false;
  end if;
  if new.is_next_up and (tg_op = 'INSERT' or not old.is_next_up) then
    perform pg_advisory_xact_lock(hashtext('next-up:' || new.project_id::text));
    if (select count(*) from public.parts where project_id = new.project_id and is_next_up and id <> new.id) >= 3 then
      raise exception 'next_up_limit' using errcode = '22023', hint = 'Only three parts can be "next up" at once.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.parts_next_up_guard() from public, anon, authenticated;
-- Runs after parts_lifecycle (alphabetical), so a part that just became funded leaves the queue.
create trigger parts_next_up_guard before insert or update on public.parts
  for each row execute function public.parts_next_up_guard();

revoke update on public.parts from authenticated;
grant update (name, estimate_cents, status, condition, description, thumbnail_url, sort_order, priority,
  kind, model_url, image_urls, actual_cost_cents,
  is_next_up, car_placement, before_image_url, after_image_url, receipt_url) on public.parts to authenticated;

-- Reorder every card in one transaction (owners only; RLS applies).
create or replace function public.reorder_parts(p_project_id uuid, p_slugs text[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_project_admin(p_project_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.parts pt
     set sort_order = o.ord
    from unnest(p_slugs) with ordinality as o(slug, ord)
   where pt.project_id = p_project_id and pt.slug = o.slug and pt.sort_order is distinct from o.ord;
end;
$$;
revoke all on function public.reorder_parts(uuid, text[]) from public, anon;
grant execute on function public.reorder_parts(uuid, text[]) to authenticated;

-- ================================================================ 2. currency
-- Project S6 keeps its fixed 10,000 goal, now in any of the supported currencies.
alter table public.projects drop constraint project_s6_fixed_goal;
alter table public.projects add constraint project_s6_fixed_goal
  check (slug <> 'project-s6' or (currency in ('usd', 'eur', 'ron', 'gbp') and goal_cents = 1000000));

-- Totals only count money in the project's currency, so it can change only while no
-- payment in another currency exists.
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
  if exists (select 1 from public.donations where project_id = p_project_id and status in ('paid', 'processing') and currency <> p_currency)
     or exists (select 1 from public.recurring_supports where project_id = p_project_id and status in ('active', 'past_due') and currency <> p_currency) then
    raise exception 'currency_locked' using errcode = '22023', hint = 'Payments already exist in the current currency.';
  end if;
  update public.projects set currency = p_currency where id = p_project_id;
end;
$$;

-- ================================================================ 6a. recurring table
-- (created before the functions that reference it)
create table public.recurring_supports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete restrict,
  part_id uuid,
  attempt_id uuid not null unique,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  display_name text check (char_length(display_name) <= 40),
  is_public boolean not null default false,
  notify_updates boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'active', 'past_due', 'canceled', 'expired')),
  donor_email text check (char_length(donor_email) <= 320),
  stripe_checkout_session_id text unique,
  stripe_subscription_id text unique,
  stripe_customer_id text,
  terms_version text not null,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_part_same_project foreign key (part_id, project_id)
    references public.parts (id, project_id) on delete set null (part_id)
);
create index recurring_supports_project_idx on public.recurring_supports (project_id, status);
create trigger recurring_supports_updated_at before update on public.recurring_supports
  for each row execute function public.set_updated_at();
alter table public.recurring_supports enable row level security;
revoke all on public.recurring_supports from public, anon, authenticated;
grant all on public.recurring_supports to service_role;

revoke all on function public.set_project_currency(uuid, text) from public, anon;
grant execute on function public.set_project_currency(uuid, text) to authenticated;

-- ================================================================ 3. donor update emails
alter table public.donations
  add column notify_updates boolean not null default false,
  add column recurring_id uuid references public.recurring_supports (id) on delete set null,
  add column stripe_invoice_id text unique;
create index donations_recurring_idx on public.donations (recurring_id) where recurring_id is not null;

-- Checkout entry point for one-off contributions (replaces create_consented_donation in the API).
create or replace function public.create_checkout_donation(
  p_attempt_id uuid, p_project_slug text, p_part_slug text, p_amount_cents bigint,
  p_display_name text, p_is_public boolean, p_terms_version text, p_notify_updates boolean
)
returns table (donation_id uuid, project_id uuid, currency text, part_slug text, part_name text,
  amount_cents bigint, stripe_checkout_session_id text, status text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  return query select * from public.create_consented_donation(p_attempt_id, p_project_slug, p_part_slug, p_amount_cents,
    p_display_name, p_is_public, p_terms_version);
  select d.id into v_id from public.donations d where d.attempt_id = p_attempt_id;
  -- Only a still-pending attempt may change its email preference.
  update public.donations d set notify_updates = coalesce(p_notify_updates, false)
   where d.id = v_id and d.status = 'pending';
end;
$$;
revoke all on function public.create_checkout_donation(uuid, text, text, bigint, text, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.create_checkout_donation(uuid, text, text, bigint, text, boolean, text, boolean) to service_role;

-- A paid contribution with the box ticked follows its part (or the whole build).
-- The donor gave this email to Stripe and asked for updates at checkout; every email
-- carries an unsubscribe link. An active subscription is never narrowed or moved.
create or replace function public.donations_follow_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.subscribers%rowtype;
begin
  if new.status <> 'paid' or not new.notify_updates or new.donor_email is null or new.needs_review then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'paid' and old.notify_updates and old.donor_email is not distinct from new.donor_email then
    return null;
  end if;
  select * into s from public.subscribers where project_id = new.project_id and email = lower(new.donor_email) for update;
  if not found then
    insert into public.subscribers (project_id, email, part_id, status, consent_version, consent_at, confirmed_at)
    values (new.project_id, lower(new.donor_email), new.part_id, 'active', coalesce(new.terms_version, '2026-11-19'), now(), now())
    on conflict (project_id, email) do nothing;
  elsif s.status <> 'active' then
    update public.subscribers
       set status = 'active', part_id = new.part_id, confirmed_at = now(), unsubscribed_at = null,
           token_hash = null, token_expires_at = null, consent_version = coalesce(new.terms_version, '2026-11-19'), consent_at = now()
     where id = s.id;
  end if;
  return null;
end;
$$;
revoke all on function public.donations_follow_updates() from public, anon, authenticated;
create trigger donations_follow_updates after insert or update of status, notify_updates, donor_email, needs_review on public.donations
  for each row execute function public.donations_follow_updates();

-- ================================================================ 4. funded by
-- Public names behind one part: only contributions marked public, net of refunds.
create or replace function public.get_part_supporters(p_slug text, p_part_slug text, p_limit integer default 30)
returns table (display_name text, total_cents bigint, contribution_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select min(btrim(d.display_name)), sum(d.amount_cents - d.refunded_cents)::bigint, count(*)
    from public.donations d
    join public.projects p on p.id = d.project_id
    join public.parts pt on pt.id = d.part_id
   where p.slug = p_slug and p.is_published and pt.slug = p_part_slug
     and d.status = 'paid' and not d.needs_review and d.is_public and d.currency = p.currency
     and d.refunded_cents < d.amount_cents and nullif(btrim(d.display_name), '') is not null
   group by lower(btrim(d.display_name))
   order by 2 desc, 1
   limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;
revoke all on function public.get_part_supporters(text, text, integer) from public;
grant execute on function public.get_part_supporters(text, text, integer) to anon, authenticated;

-- ================================================================ 5. votes
create table public.polls (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  question text not null check (char_length(btrim(question)) between 3 and 200),
  description text check (char_length(description) <= 2000),
  status text not null default 'open' check (status in ('open', 'closed')),
  closes_at timestamptz,
  winner_option_id uuid,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, project_id)
);
create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null,
  project_id uuid not null,
  label text not null check (char_length(btrim(label)) between 1 and 80),
  description text check (char_length(description) <= 500),
  image_url text check (image_url is null or (char_length(image_url) <= 500 and image_url ~ '^(https://|/[^/])')),
  estimate_cents bigint check (estimate_cents is null or estimate_cents > 0),
  part_id uuid,
  sort_order integer not null default 0,
  unique (id, poll_id),
  constraint poll_options_poll foreign key (poll_id, project_id) references public.polls (id, project_id) on delete cascade,
  constraint poll_options_part foreign key (part_id, project_id) references public.parts (id, project_id) on delete set null (part_id)
);
alter table public.polls add constraint polls_winner foreign key (winner_option_id, id)
  references public.poll_options (id, poll_id) on delete set null (winner_option_id) deferrable initially deferred;
create table public.poll_votes (
  poll_id uuid not null,
  option_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id),
  constraint poll_votes_option foreign key (option_id, poll_id) references public.poll_options (id, poll_id) on delete cascade
);
create index poll_options_poll_idx on public.poll_options (poll_id, sort_order);
create index poll_votes_option_idx on public.poll_votes (option_id);

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
revoke all on public.polls, public.poll_options, public.poll_votes from public, anon, authenticated;
grant select on public.polls, public.poll_options to anon, authenticated;
grant insert (project_id, question, description, closes_at) on public.polls to authenticated;
grant update (question, description, closes_at, status) on public.polls to authenticated;
grant delete on public.polls to authenticated;
grant insert (poll_id, project_id, label, description, image_url, estimate_cents, sort_order) on public.poll_options to authenticated;
grant update (label, description, image_url, estimate_cents, sort_order) on public.poll_options to authenticated;
grant delete on public.poll_options to authenticated;
grant select on public.poll_votes to authenticated;
grant all on public.polls, public.poll_options, public.poll_votes to service_role;

create policy "Polls of published projects are public" on public.polls for select to anon, authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.is_published) or public.is_project_admin(project_id));
create policy "Owners create polls" on public.polls for insert to authenticated with check (public.is_project_admin(project_id));
create policy "Owners edit polls" on public.polls for update to authenticated
  using (public.is_project_admin(project_id)) with check (public.is_project_admin(project_id));
create policy "Owners delete polls" on public.polls for delete to authenticated using (public.is_project_admin(project_id));
create policy "Poll options are public" on public.poll_options for select to anon, authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.is_published) or public.is_project_admin(project_id));
create policy "Owners create options" on public.poll_options for insert to authenticated with check (public.is_project_admin(project_id));
create policy "Owners edit options" on public.poll_options for update to authenticated
  using (public.is_project_admin(project_id)) with check (public.is_project_admin(project_id));
create policy "Owners delete options" on public.poll_options for delete to authenticated using (public.is_project_admin(project_id));
-- Who voted for what stays private; members only see their own vote.
create policy "Members see their own vote" on public.poll_votes for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.get_poll_results(p_slug text)
returns table (poll_id uuid, option_id uuid, votes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select o.poll_id, o.id, count(v.user_id)
    from public.poll_options o
    join public.polls pl on pl.id = o.poll_id
    join public.projects p on p.id = pl.project_id
    left join public.poll_votes v on v.option_id = o.id and v.poll_id = o.poll_id
   where p.slug = p_slug and p.is_published
   group by o.poll_id, o.id;
$$;
revoke all on function public.get_poll_results(text) from public;
grant execute on function public.get_poll_results(text) to anon, authenticated;

-- One vote per confirmed account per poll; voting again changes the vote.
create or replace function public.cast_poll_vote(p_poll_id uuid, p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_poll public.polls%rowtype;
begin
  if v_user is null then raise exception 'sign_in_required' using errcode = '42501'; end if;
  if not exists (select 1 from auth.users where id = v_user and email_confirmed_at is not null) then
    raise exception 'email_unconfirmed' using errcode = '42501';
  end if;
  select * into v_poll from public.polls where id = p_poll_id;
  if not found or not exists (select 1 from public.projects where id = v_poll.project_id and is_published) then
    raise exception 'poll_not_found' using errcode = 'P0002';
  end if;
  if v_poll.status <> 'open' or (v_poll.closes_at is not null and v_poll.closes_at <= now()) then
    raise exception 'poll_closed' using errcode = '22023';
  end if;
  if not exists (select 1 from public.poll_options where id = p_option_id and poll_id = p_poll_id) then
    raise exception 'option_not_found' using errcode = 'P0002';
  end if;
  insert into public.poll_votes (poll_id, option_id, user_id) values (p_poll_id, p_option_id, v_user)
  on conflict (poll_id, user_id) do update set option_id = excluded.option_id, created_at = now();
end;
$$;
revoke all on function public.cast_poll_vote(uuid, uuid) from public, anon;
grant execute on function public.cast_poll_vote(uuid, uuid) to authenticated;

-- Owner closes a poll and (optionally) turns the winning option into an open part card.
-- Returns the new part's slug, or null.
create or replace function public.close_poll(p_poll_id uuid, p_winner_option_id uuid, p_create_part boolean default true)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_poll public.polls%rowtype;
  v_opt public.poll_options%rowtype;
  v_base text;
  v_slug text;
  v_n integer := 1;
  v_part uuid;
begin
  select * into v_poll from public.polls where id = p_poll_id;
  if not found or not public.is_project_admin(v_poll.project_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_winner_option_id is not null then
    select * into v_opt from public.poll_options where id = p_winner_option_id and poll_id = p_poll_id;
    if not found then raise exception 'option_not_found' using errcode = 'P0002'; end if;
  end if;
  update public.polls set status = 'closed', closes_at = coalesce(least(closes_at, now()), now()),
         winner_option_id = p_winner_option_id
   where id = p_poll_id;

  if p_create_part and v_opt.id is not null and v_opt.part_id is null then
    if v_opt.estimate_cents is null then
      raise exception 'estimate_required' using errcode = '22023', hint = 'Give the winning option an estimate first.';
    end if;
    v_base := left(trim(both '-' from lower(regexp_replace(v_opt.label, '[^a-zA-Z0-9]+', '-', 'g'))), 50);
    if v_base = '' then v_base := 'voted-part'; end if;
    v_slug := v_base;
    while exists (select 1 from public.parts where project_id = v_poll.project_id and slug = v_slug) loop
      v_n := v_n + 1;
      v_slug := v_base || '-' || v_n;
    end loop;
    insert into public.parts (project_id, slug, name, estimate_cents, status, kind, description, image_urls, thumbnail_url, sort_order, condition)
    values (v_poll.project_id, v_slug, btrim(v_opt.label), v_opt.estimate_cents, 'upgrade', 'upgrade',
            coalesce(v_opt.description, 'Chosen by supporters: ' || btrim(v_poll.question)),
            case when v_opt.image_url is null then '{}' else array[v_opt.image_url] end, v_opt.image_url,
            coalesce((select max(sort_order) + 1 from public.parts where project_id = v_poll.project_id), 0), 'Voted by supporters')
    returning id into v_part;
    update public.poll_options set part_id = v_part where id = v_opt.id;
    return v_slug;
  end if;
  return null;
end;
$$;
revoke all on function public.close_poll(uuid, uuid, boolean) from public, anon;
grant execute on function public.close_poll(uuid, uuid, boolean) to authenticated;
-- close_poll writes these as the owner (RLS-checked), not through the client grants above.
grant update (winner_option_id) on public.polls to authenticated;
grant update (part_id) on public.poll_options to authenticated;

-- ================================================================ 6b. recurring functions
create or replace function public.create_recurring_support(
  p_attempt_id uuid, p_project_slug text, p_part_slug text, p_amount_cents bigint,
  p_display_name text, p_is_public boolean, p_terms_version text, p_notify_updates boolean
)
returns table (recurring_id uuid, currency text, part_slug text, part_name text, amount_cents bigint,
  stripe_checkout_session_id text, status text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_project public.projects%rowtype;
  v_part public.parts%rowtype;
  r public.recurring_supports%rowtype;
begin
  if p_terms_version is distinct from '2026-11-19' then raise exception 'consent_required' using errcode = '22023'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'invalid_amount' using errcode = '22023'; end if;
  select * into v_project from public.projects where slug = p_project_slug and is_published;
  if not found then raise exception 'project_not_found' using errcode = 'P0002'; end if;
  if p_part_slug is not null then
    select * into v_part from public.parts where project_id = v_project.id and slug = p_part_slug;
    if not found then raise exception 'part_not_found' using errcode = 'P0002'; end if;
    if v_part.status not in ('needed', 'upgrade') and not exists (select 1 from public.recurring_supports x where x.attempt_id = p_attempt_id) then
      raise exception 'part_closed' using errcode = '22023';
    end if;
  end if;
  insert into public.recurring_supports (project_id, part_id, attempt_id, amount_cents, currency, display_name, is_public, notify_updates, terms_version)
  values (v_project.id, v_part.id, p_attempt_id, p_amount_cents, v_project.currency, nullif(btrim(p_display_name), ''),
          coalesce(p_is_public, false), coalesce(p_notify_updates, false), p_terms_version)
  on conflict (attempt_id) do nothing;
  select * into r from public.recurring_supports x where x.attempt_id = p_attempt_id;
  if r.project_id <> v_project.id or r.amount_cents <> p_amount_cents or r.part_id is distinct from v_part.id
     or r.display_name is distinct from nullif(btrim(p_display_name), '') or r.is_public <> coalesce(p_is_public, false) then
    raise exception 'attempt_mismatch' using errcode = '23505';
  end if;
  return query select r.id, r.currency, v_part.slug, v_part.name, r.amount_cents, r.stripe_checkout_session_id, r.status;
end;
$$;

create or replace function public.attach_recurring_session(p_recurring_id uuid, p_session_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.recurring_supports set stripe_checkout_session_id = p_session_id
   where id = p_recurring_id and status = 'pending'
     and (stripe_checkout_session_id is null or stripe_checkout_session_id = p_session_id);
  return found;
end;
$$;

-- One entry point for subscription webhooks. Each paid invoice becomes one donation
-- (idempotent on the invoice id) that counts toward the part while it is open, and
-- toward the general fund once the part is funded or closed.
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
    update public.recurring_supports
       set status = case when status = 'pending' then 'active' else status end,
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
             when p_subscription_status in ('past_due', 'unpaid') then 'past_due'
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

-- Return page and "manage" link: scoped to the unguessable Checkout Session id.
create or replace function public.get_recurring_by_session(p_session_id text)
returns table (status text, amount_cents bigint, currency text, part_name text, stripe_customer_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.status, r.amount_cents, r.currency, pt.name, r.stripe_customer_id
    from public.recurring_supports r left join public.parts pt on pt.id = r.part_id
   where r.stripe_checkout_session_id = p_session_id;
$$;

revoke all on function public.create_recurring_support(uuid, text, text, bigint, text, boolean, text, boolean),
  public.attach_recurring_session(uuid, text),
  public.process_recurring_event(text, text, boolean, uuid, text, text, text, text, text, text, bigint, text, text),
  public.get_recurring_by_session(text) from public, anon, authenticated;
grant execute on function public.create_recurring_support(uuid, text, text, bigint, text, boolean, text, boolean),
  public.attach_recurring_session(uuid, text),
  public.process_recurring_event(text, text, boolean, uuid, text, text, text, text, text, text, bigint, text, text),
  public.get_recurring_by_session(text) to service_role;

-- Public count of monthly supporters (no names, no amounts per person).
create or replace function public.get_recurring_summary(p_slug text)
returns table (active_count bigint, monthly_cents bigint, currency text)
language sql
stable
security definer
set search_path = ''
as $$
  select count(r.id) filter (where r.status = 'active'),
         coalesce(sum(r.amount_cents) filter (where r.status = 'active' and r.currency = p.currency), 0)::bigint,
         p.currency
    from public.projects p left join public.recurring_supports r on r.project_id = p.id
   where p.slug = p_slug and p.is_published
   group by p.id;
$$;
revoke all on function public.get_recurring_summary(text) from public;
grant execute on function public.get_recurring_summary(text) to anon, authenticated;

-- ================================================================ 7. owner digest
create table public.owner_digests (
  project_id uuid not null references public.projects (id) on delete cascade,
  digest_date date not null,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_id text,
  primary key (project_id, digest_date)
);
alter table public.owner_digests enable row level security;
revoke all on public.owner_digests from public, anon, authenticated;
grant all on public.owner_digests to service_role;

-- Claims today's digest for every published project (one sender wins; a stale claim
-- older than 15 minutes can be retried) and returns what to send.
create or replace function public.claim_owner_digests(p_date date)
returns table (project_id uuid, project_title text, currency text, recipients text[], summary jsonb)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  p public.projects%rowtype;
  v_since timestamptz := (p_date::timestamp - interval '1 day') at time zone 'utc';
  v_until timestamptz := p_date::timestamp at time zone 'utc';
  v_claimed boolean;
begin
  for p in select * from public.projects where is_published loop
    insert into public.owner_digests (project_id, digest_date) values (p.id, p_date)
    on conflict (project_id, digest_date) do update set claimed_at = now()
      where owner_digests.sent_at is null and owner_digests.claimed_at < now() - interval '15 minutes'
    returning true into v_claimed;
    continue when v_claimed is null;
    v_claimed := null;
    return query
      select p.id, p.title, p.currency,
        array(select u.email::text from public.project_admins a join auth.users u on u.id = a.user_id
               where a.project_id = p.id and u.email is not null and u.email_confirmed_at is not null),
        jsonb_build_object(
          'raised_cents', (select coalesce(sum(d.amount_cents - d.refunded_cents), 0) from public.donations d
                            where d.project_id = p.id and d.status = 'paid' and not d.needs_review and d.currency = p.currency
                              and d.paid_at >= v_since and d.paid_at < v_until),
          'contributions', (select count(*) from public.donations d where d.project_id = p.id and d.status = 'paid'
                              and d.paid_at >= v_since and d.paid_at < v_until),
          'refunded_cents', (select coalesce(sum(d.refunded_cents), 0) from public.donations d
                              where d.project_id = p.id and d.refunded_cents > 0 and d.updated_at >= v_since and d.updated_at < v_until),
          'needs_review', (select count(*) from public.donations d where d.project_id = p.id and d.needs_review),
          'newly_funded', (select coalesce(jsonb_agg(pt.name order by pt.funded_at), '[]') from public.parts pt
                            where pt.project_id = p.id and pt.funded_at >= v_since and pt.funded_at < v_until),
          'ready_to_buy', (select coalesce(jsonb_agg(pt.name order by pt.funded_at), '[]') from public.parts pt
                            where pt.project_id = p.id and pt.status = 'funded'),
          'pending_posts', (select count(*) from public.community_posts c where c.project_id = p.id and c.status = 'pending'),
          'monthly_active', (select count(*) from public.recurring_supports r where r.project_id = p.id and r.status = 'active'),
          'monthly_past_due', (select count(*) from public.recurring_supports r where r.project_id = p.id and r.status = 'past_due')
        );
  end loop;
end;
$$;
create or replace function public.finish_owner_digest(p_project_id uuid, p_date date, p_provider text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.owner_digests set sent_at = case when p_provider is not null then now() end, provider_id = p_provider,
    claimed_at = case when p_provider is null then now() - interval '1 hour' else claimed_at end
   where project_id = p_project_id and digest_date = p_date;
$$;
revoke all on function public.claim_owner_digests(date), public.finish_owner_digest(uuid, date, text) from public, anon, authenticated;
grant execute on function public.claim_owner_digests(date), public.finish_owner_digest(uuid, date, text) to service_role;

-- ================================================================ 8. readable update emails
create or replace function public.queue_project_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_delay constant interval := interval '10 minutes';
  v_title text; v_body text; v_part uuid; v_path text; v_source text; v_payload jsonb; v_currency text; v_stage text;
begin
  if tg_op = 'DELETE' then
    update public.email_jobs set state = 'cancelled'
      where state = 'pending'
        and payload->>'source' = (case when tg_table_name = 'parts' then 'part:' else 'update:' end) || old.id::text;
    return old;
  end if;

  if tg_table_name = 'parts' then
    if tg_op = 'UPDATE' and (new.name,new.estimate_cents,new.status,new.description,new.priority,new.condition,new.thumbnail_url)
      is not distinct from (old.name,old.estimate_cents,old.status,old.description,old.priority,old.condition,old.thumbnail_url) then return new; end if;
    select upper(currency) into v_currency from public.projects where id = new.project_id;
    v_stage := case new.status
      when 'needed' then 'needs funding' when 'upgrade' then 'open for funding (upgrade)'
      when 'funded' then 'fully funded — buying next' when 'ordered' then 'ordered'
      when 'bought' then 'bought' when 'installed' then 'installed on the car' else new.status end;
    v_part := new.id;
    v_source := 'part:' || new.id::text;
    v_title := case when tg_op = 'UPDATE' and new.status is distinct from old.status
                    then new.name || ' is ' || v_stage else 'Part update: ' || new.name end;
    v_body := new.name || ' · ' || v_stage || ' · Goal ' || coalesce(v_currency, 'USD') || ' '
      || to_char(new.estimate_cents / 100.0, 'FM999999990.00') || E'\n' || coalesce(new.description, '');
    v_path := '/parts/' || new.slug;
  else
    v_source := 'update:' || new.id::text;
    if new.published_at is null or new.published_at > now() then
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

-- ================================================================ 9. policy version 2026-11-19
-- Terms now cover monthly support, update emails for donors, votes and currencies, so
-- every consent records the new version. Same functions as before, new version check.
create or replace function public.create_consented_donation(
  p_attempt_id uuid, p_project_slug text, p_part_slug text, p_amount_cents bigint,
  p_display_name text, p_is_public boolean, p_terms_version text
)
returns table (donation_id uuid, project_id uuid, currency text, part_slug text, part_name text,
  amount_cents bigint, stripe_checkout_session_id text, status text)
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_terms_version is distinct from '2026-11-19' then
    raise exception 'consent_required' using errcode = '22023';
  end if;
  return query select * from public.create_pending_donation(p_attempt_id, p_project_slug, p_part_slug, p_amount_cents, p_display_name, p_is_public);
  select d.id into v_id from public.donations d where d.attempt_id = p_attempt_id for update;
  if exists (select 1 from public.donations d where d.id = v_id and
    (d.display_name is distinct from nullif(btrim(p_display_name), '') or d.is_public is distinct from p_is_public)) then
    raise exception 'attempt_mismatch' using errcode = '23505';
  end if;
  update public.donations d set terms_version = p_terms_version, privacy_version = p_terms_version,
    terms_accepted_at = coalesce(d.terms_accepted_at, now()) where d.id = v_id;
end;
$$;

create or replace function public.request_subscription(p_slug text,p_email text,p_part_slug text,p_hash text,p_url text,p_consent text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_project uuid; v_part uuid; s public.subscribers%rowtype;
begin
  select id into v_project from public.projects where slug=p_slug and is_published;
  if v_project is null then raise exception 'project_not_found'; end if;
  if p_consent is distinct from '2026-11-19' then raise exception 'consent_required'; end if;
  if p_part_slug is not null then
    select id into v_part from public.parts where project_id=v_project and slug=p_part_slug;
    if v_part is null then raise exception 'part_not_found'; end if;
  end if;
  insert into public.subscribers(project_id,email,part_id,token_hash,token_expires_at,consent_version)
    values(v_project,lower(p_email),v_part,p_hash,now()+interval '24 hours',p_consent)
    on conflict(project_id,email) do nothing;
  select * into s from public.subscribers where project_id=v_project and email=lower(p_email) for update;
  -- A stranger cannot overwrite an active member's preferences or spam their inbox.
  if s.status='active' then return; end if;
  if s.token_hash is distinct from p_hash and s.requested_at > now()-interval '1 hour' then return; end if;
  update public.subscribers set status='pending',part_id=v_part,token_hash=p_hash,
    token_expires_at=now()+interval '24 hours',requested_at=now(),consent_version=p_consent,consent_at=now()
    where id=s.id;
  insert into public.email_jobs(subscriber_id,kind,payload,unique_key)
    values(s.id,'confirmation',jsonb_build_object('url',p_url),'confirm-'||p_hash);
end;
$$;

create or replace function public.create_community_post(p_slug text,p_parent uuid,p_name text,p_category text,p_title text,p_body text,p_consent text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_project uuid; v_user uuid := auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception 'Sign in to post.'; end if;
  if not exists(select 1 from auth.users where id=v_user and email_confirmed_at is not null) then raise exception 'Confirm your email before posting.'; end if;
  if p_consent is distinct from '2026-11-19' then raise exception 'Please accept the community guidelines.'; end if;
  select id into v_project from public.projects where slug=p_slug and is_published;
  if v_project is null then raise exception 'Project unavailable.'; end if;
  -- Lock per account to make the rate limit effective against concurrent requests.
  perform pg_advisory_xact_lock(hashtext(v_user::text));
  if exists(select 1 from public.community_posts where author_id=v_user and created_at>now()-interval '1 minute')
    or (select count(*) from public.community_posts where author_id=v_user and created_at>now()-interval '1 hour')>=5
    then raise exception 'Please wait before posting again.'; end if;
  if p_parent is not null and not exists(select 1 from public.community_posts where id=p_parent and project_id=v_project and status='approved' and parent_id is null) then raise exception 'Discussion unavailable.'; end if;
  insert into public.community_posts(project_id,author_id,parent_id,display_name,category,title,body,status,consent_version)
    values(v_project,v_user,p_parent,btrim(p_name),p_category,btrim(p_title),btrim(p_body),
      case when public.is_project_admin(v_project) then 'approved' else 'pending' end,p_consent) returning id into v_id;
  return v_id;
end;
$$;
