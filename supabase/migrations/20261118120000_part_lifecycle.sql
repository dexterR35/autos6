-- Part cards: lifecycle, media and purchase records (18 November 2026).
--
-- Each part is its own funding goal (estimate_cents). The lifecycle is:
--
--   needed / upgrade  → open for contributions (the two values only record the kind)
--   funded            → set automatically when paid, unrefunded contributions reach the goal
--   ordered           → owner placed the order
--   bought            → owner has the part
--   installed         → fitted to the car
--
-- "funded" is the only automatic step and it reverses itself if a refund (or a raised
-- goal) takes the part back under its target. Every later step is an owner action, and
-- record_part_progress() can post the matching restoration update in the same transaction.
-- New contributions to a part are accepted only while it is open, and never for more than
-- what is left of its goal (the general fund is always open).

-- ---------------------------------------------------------------- columns
alter table public.parts
  add column kind text not null default 'repair' check (kind in ('repair', 'upgrade')),
  add column model_url text check (model_url is null or (char_length(model_url) <= 500 and model_url ~ '^(https://|/[^/])')),
  add column image_urls text[] not null default '{}' check (cardinality(image_urls) <= 12),
  add column actual_cost_cents bigint check (actual_cost_cents is null or actual_cost_cents >= 0),
  add column funded_at timestamptz,
  add column ordered_at timestamptz,
  add column bought_at timestamptz,
  add column installed_at timestamptz;

update public.parts set kind = 'upgrade' where status = 'upgrade';

alter table public.parts drop constraint parts_status_check;
alter table public.parts add constraint parts_status_check
  check (status in ('needed', 'upgrade', 'funded', 'ordered', 'bought', 'installed'));

update public.parts set bought_at = coalesce(bought_at, updated_at) where status = 'bought';

-- Updates can belong to one part (same project only), so a part card can show its build log.
alter table public.restoration_updates add column part_id uuid;
alter table public.restoration_updates add constraint restoration_updates_part_same_project
  foreign key (part_id, project_id) references public.parts (id, project_id) on delete set null (part_id);
create index restoration_updates_part_idx on public.restoration_updates (part_id) where part_id is not null;

-- ---------------------------------------------------------------- lifecycle normaliser
-- Keeps status, kind and the stage timestamps consistent whatever the client sends.
create or replace function public.parts_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_rank integer;
begin
  if new.status in ('needed', 'upgrade') then
    if tg_op = 'UPDATE' and new.status = old.status and new.kind is distinct from old.kind then
      new.status := case when new.kind = 'upgrade' then 'upgrade' else 'needed' end;
    else
      new.kind := case when new.status = 'upgrade' then 'upgrade' else 'repair' end;
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.funded_at := null; new.ordered_at := null; new.bought_at := null; new.installed_at := null;
  else
    new.funded_at := old.funded_at; new.ordered_at := old.ordered_at;
    new.bought_at := old.bought_at; new.installed_at := old.installed_at;
  end if;

  if tg_op = 'INSERT' or new.status is distinct from old.status then
    v_rank := case new.status when 'funded' then 1 when 'ordered' then 2 when 'bought' then 3 when 'installed' then 4 else 0 end;
    if v_rank < 1 then new.funded_at := null; end if;
    if v_rank < 2 then new.ordered_at := null; end if;
    if v_rank < 3 then new.bought_at := null; end if;
    if v_rank < 4 then new.installed_at := null; end if;
    case v_rank
      when 1 then new.funded_at := coalesce(new.funded_at, now());
      when 2 then new.ordered_at := coalesce(new.ordered_at, now());
      when 3 then new.bought_at := coalesce(new.bought_at, now());
      when 4 then new.installed_at := coalesce(new.installed_at, now());
      else null;
    end case;
  end if;
  return new;
end;
$$;
revoke all on function public.parts_lifecycle() from public, anon, authenticated;

create trigger parts_lifecycle before insert or update on public.parts
  for each row execute function public.parts_lifecycle();

-- ---------------------------------------------------------------- funding
-- Net paid contributions to one part, using the same rules as get_part_funding.
create or replace function public.part_raised_cents(p_part_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(d.amount_cents - d.refunded_cents), 0)::bigint
    from public.donations d
    join public.parts pt on pt.id = d.part_id
    join public.projects p on p.id = pt.project_id
   where d.part_id = p_part_id and d.project_id = p.id
     and d.status = 'paid' and not d.needs_review and d.currency = p.currency;
$$;
revoke all on function public.part_raised_cents(uuid) from public, anon, authenticated;
grant execute on function public.part_raised_cents(uuid) to service_role;

-- open → funded when the goal is met; funded → open again if it no longer is.
-- Owner stages (ordered, bought, installed) are never changed here.
create or replace function public.sync_part_funding(p_part_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_part public.parts%rowtype;
  v_raised bigint;
begin
  if p_part_id is null then return; end if;
  select * into v_part from public.parts where id = p_part_id for update;
  if not found or v_part.status not in ('needed', 'upgrade', 'funded') then return; end if;
  v_raised := public.part_raised_cents(p_part_id);
  if v_part.status in ('needed', 'upgrade') and v_part.estimate_cents > 0 and v_raised >= v_part.estimate_cents then
    update public.parts set status = 'funded' where id = p_part_id;
  elsif v_part.status = 'funded' and v_raised < v_part.estimate_cents then
    update public.parts set status = case when v_part.kind = 'upgrade' then 'upgrade' else 'needed' end where id = p_part_id;
  end if;
end;
$$;
revoke all on function public.sync_part_funding(uuid) from public, anon, authenticated;

create or replace function public.donations_sync_part()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' and old.part_id is distinct from new.part_id then
    perform public.sync_part_funding(old.part_id);
  end if;
  perform public.sync_part_funding(new.part_id);
  return null;
end;
$$;
revoke all on function public.donations_sync_part() from public, anon, authenticated;

create trigger donations_sync_part
  after insert or update of status, refunded_cents, needs_review, part_id, currency on public.donations
  for each row execute function public.donations_sync_part();

create or replace function public.parts_goal_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sync_part_funding(new.id);
  return null;
end;
$$;
revoke all on function public.parts_goal_changed() from public, anon, authenticated;

create trigger parts_goal_changed
  after update of estimate_cents on public.parts
  for each row when (old.estimate_cents is distinct from new.estimate_cents)
  execute function public.parts_goal_changed();

-- Bring existing rows in line (parts that already met their goal become "funded").
select public.sync_part_funding(id) from public.parts;

-- ---------------------------------------------------------------- checkout gating
-- Same as before, plus: a new attempt for a part is refused once the part is no longer
-- open, or when it asks for more than what is left of the part's goal. Retrying an
-- existing attempt still returns that attempt unchanged.
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
      -- Below $1 left, a $1 contribution may still finish the part.
      v_remaining := greatest(v_part.estimate_cents - public.part_raised_cents(v_part.id), 0);
      if p_amount_cents > greatest(v_remaining, 100) then
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

-- ---------------------------------------------------------------- owner: record progress
-- One call moves a part to ordered / bought / installed and (optionally) posts the
-- restoration update for it. Runs as the caller, so RLS and column grants still apply.
create or replace function public.record_part_progress(
  p_part_id uuid,
  p_status text,
  p_actual_cost_cents bigint default null,
  p_title text default null,
  p_body text default null,
  p_image_urls text[] default '{}',
  p_publish boolean default true
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_part public.parts%rowtype;
  v_update uuid;
begin
  if p_status is null or p_status not in ('ordered', 'bought', 'installed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_actual_cost_cents is not null and p_actual_cost_cents < 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  select * into v_part from public.parts where id = p_part_id;
  if not found or not public.is_project_admin(v_part.project_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  update public.parts
     set status = p_status,
         actual_cost_cents = coalesce(p_actual_cost_cents, actual_cost_cents)
   where id = v_part.id;

  if nullif(btrim(coalesce(p_title, '')), '') is not null then
    insert into public.restoration_updates (project_id, part_id, title, body, image_urls, cost_cents, published_at, created_by)
    values (v_part.project_id, v_part.id, btrim(p_title), coalesce(p_body, ''), coalesce(p_image_urls, '{}'),
            p_actual_cost_cents, case when coalesce(p_publish, true) then now() end, (select auth.uid()))
    returning id into v_update;
  end if;
  return v_update;
end;
$$;
revoke all on function public.record_part_progress(uuid, text, bigint, text, text, text[], boolean) from public, anon;
grant execute on function public.record_part_progress(uuid, text, bigint, text, text, text[], boolean) to authenticated;

-- ---------------------------------------------------------------- grants
-- Stage timestamps are written by the trigger only.
revoke update on public.parts from authenticated;
grant update (name, estimate_cents, status, condition, description, thumbnail_url, sort_order, priority,
  kind, model_url, image_urls, actual_cost_cents) on public.parts to authenticated;
revoke update on public.restoration_updates from authenticated;
grant update (title, body, image_urls, cost_cents, published_at, part_id) on public.restoration_updates to authenticated;
