-- Row Level Security and explicit grants.
-- Supabase grants broad default privileges on new public tables to anon/authenticated,
-- so every table first revokes everything and then grants only what is needed.
-- Owner writes require membership in project_admins — being signed in is not enough.

alter table public.projects enable row level security;
alter table public.parts enable row level security;
alter table public.project_admins enable row level security;
alter table public.restoration_updates enable row level security;
alter table public.donations enable row level security;
alter table public.stripe_events enable row level security;

revoke all on table public.projects, public.parts, public.project_admins, public.restoration_updates,
  public.donations, public.stripe_events from anon, authenticated;

-- ---------------------------------------------------------------- membership helper
create or replace function public.is_project_admin(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_admins pa
    where pa.project_id = p_project_id and pa.user_id = (select auth.uid())
  );
$$;
revoke execute on function public.is_project_admin(uuid) from public;
-- anon needs EXECUTE because policies call it; it simply returns false without a user.
grant execute on function public.is_project_admin(uuid) to anon, authenticated;

-- ---------------------------------------------------------------- projects
grant select on public.projects to anon, authenticated;
-- slug and currency are deliberately not updatable from the client.
grant update (title, tagline, vehicle_display_name, goal_cents, description, is_published) on public.projects to authenticated;

create policy "Published projects are public"
  on public.projects for select to anon, authenticated
  using (is_published or (select public.is_project_admin(id)));

create policy "Owners update their project"
  on public.projects for update to authenticated
  using ((select public.is_project_admin(id)))
  with check ((select public.is_project_admin(id)));

-- ---------------------------------------------------------------- parts
grant select on public.parts to anon, authenticated;
grant insert, update, delete on public.parts to authenticated;

create policy "Parts of published projects are public"
  on public.parts for select to anon, authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.is_published));

create policy "Owners insert parts"
  on public.parts for insert to authenticated
  with check ((select public.is_project_admin(project_id)));

create policy "Owners update parts"
  on public.parts for update to authenticated
  using ((select public.is_project_admin(project_id)))
  with check ((select public.is_project_admin(project_id)));

create policy "Owners delete parts"
  on public.parts for delete to authenticated
  using ((select public.is_project_admin(project_id)));

-- ---------------------------------------------------------------- restoration updates
grant select on public.restoration_updates to anon, authenticated;
grant insert, update, delete on public.restoration_updates to authenticated;

create policy "Published updates are public"
  on public.restoration_updates for select to anon, authenticated
  using (
    published_at is not null and published_at <= now()
    and exists (select 1 from public.projects p where p.id = project_id and p.is_published)
  );

create policy "Owners read all their updates"
  on public.restoration_updates for select to authenticated
  using ((select public.is_project_admin(project_id)));

create policy "Owners insert updates"
  on public.restoration_updates for insert to authenticated
  with check ((select public.is_project_admin(project_id)) and created_by = (select auth.uid()));

create policy "Owners edit updates"
  on public.restoration_updates for update to authenticated
  using ((select public.is_project_admin(project_id)))
  with check ((select public.is_project_admin(project_id)));

create policy "Owners delete updates"
  on public.restoration_updates for delete to authenticated
  using ((select public.is_project_admin(project_id)));

-- ---------------------------------------------------------------- project_admins
-- Read-only, and only your own rows. Owners are provisioned with a trusted SQL step
-- (service role / SQL editor), never from the browser.
grant select on public.project_admins to authenticated;
create policy "Users see their own memberships"
  on public.project_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- donations & stripe_events
-- No grants and no policies for anon/authenticated: only the server (service role,
-- which bypasses RLS) reads or writes payment records.

-- ---------------------------------------------------------------- safe public projections
create or replace function public.get_campaign_summary(p_slug text)
returns table (goal_cents bigint, raised_cents bigint, donation_count bigint, currency text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.goal_cents,
    coalesce(sum(d.amount_cents - d.refunded_cents) filter (where d.status = 'paid' and not d.needs_review and d.currency = p.currency), 0)::bigint,
    count(d.id) filter (where d.status = 'paid' and not d.needs_review and d.refunded_cents < d.amount_cents and d.currency = p.currency),
    p.currency
  from public.projects p
  left join public.donations d on d.project_id = p.id
  where p.slug = p_slug and p.is_published
  group by p.id;
$$;

-- Only consented display names, net amounts, part name and date. No emails, no Stripe ids.
create or replace function public.get_public_contributions(p_slug text, p_limit integer default 50)
returns table (display_name text, amount_cents bigint, part_name text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    nullif(btrim(d.display_name), ''),
    d.amount_cents - d.refunded_cents,
    pt.name,
    d.paid_at
  from public.donations d
  join public.projects p on p.id = d.project_id
  left join public.parts pt on pt.id = d.part_id
  where p.slug = p_slug and p.is_published
    and d.status = 'paid' and d.is_public and not d.needs_review
    and d.refunded_cents < d.amount_cents
  order by d.paid_at desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke execute on function public.get_campaign_summary(text) from public;
revoke execute on function public.get_public_contributions(text, integer) from public;
grant execute on function public.get_campaign_summary(text) to anon, authenticated;
grant execute on function public.get_public_contributions(text, integer) to anon, authenticated;
