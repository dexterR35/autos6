-- Keep payment amounts uncapped. Only the public presentation stops at $10,000.
update public.projects set goal_cents = 1000000, currency = 'usd' where slug = 'project-s6';
alter table public.parts add column priority text not null default 'standard' check (priority in ('important', 'standard'));
update public.parts set priority = 'important' where slug in ('front-bumper', 'exhaust', 'coilovers');
create index donations_part_paid_idx on public.donations(part_id) where status = 'paid' and not needs_review;

create function public.get_part_funding(p_slug text)
returns table (part_slug text, raised_cents bigint, donation_count bigint)
language sql stable security definer set search_path = '' as $$
  select pt.slug,
    coalesce(sum(d.amount_cents - d.refunded_cents), 0)::bigint,
    count(d.id) filter (where d.amount_cents > d.refunded_cents)
  from public.parts pt join public.projects p on p.id = pt.project_id
  left join public.donations d on d.part_id = pt.id and d.project_id = p.id
    and d.status = 'paid' and not d.needs_review and d.currency = p.currency
  where p.slug = p_slug and p.is_published group by pt.id;
$$;
revoke all on function public.get_part_funding(text) from public, anon, authenticated;
grant execute on function public.get_part_funding(text) to anon, authenticated;

alter table public.donations add column terms_version text;
alter table public.donations add column terms_accepted_at timestamptz;
alter table public.donations add column privacy_version text;

create function public.create_consented_donation(
  p_attempt_id uuid, p_project_slug text, p_part_slug text, p_amount_cents bigint,
  p_display_name text, p_is_public boolean, p_terms_version text
)
returns table (donation_id uuid, project_id uuid, currency text, part_slug text, part_name text,
  amount_cents bigint, stripe_checkout_session_id text, status text)
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_terms_version is distinct from '2026-10-21' then
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
revoke all on function public.create_consented_donation(uuid,text,text,bigint,text,boolean,text) from public,anon,authenticated;
grant execute on function public.create_consented_donation(uuid,text,text,bigint,text,boolean,text) to service_role;

-- A quarantined payment must not appear confirmed on the return page.
create or replace function public.get_donation_status(p_session_id text)
returns table (status text, amount_cents bigint, refunded_cents bigint, currency text, part_name text)
language sql stable security definer set search_path = '' as $$
  select case when d.needs_review then 'processing' else d.status end,
    d.amount_cents, d.refunded_cents, d.currency, pt.name
  from public.donations d left join public.parts pt on pt.id = d.part_id
  where d.stripe_checkout_session_id = p_session_id;
$$;

-- Membership mutation is column-scoped. Owners cannot move someone else's part
-- or author an update under another project through broad UPDATE grants.
revoke update on public.parts from authenticated;
grant update(name,estimate_cents,status,condition,description,thumbnail_url,sort_order,priority) on public.parts to authenticated;
revoke update on public.restoration_updates from authenticated;
grant update(title,body,image_urls,cost_cents,published_at) on public.restoration_updates to authenticated;
