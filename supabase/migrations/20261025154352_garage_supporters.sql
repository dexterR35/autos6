-- A public wall can list every consenting supporter without exposing the private
-- donor email used to recognize repeat contributions. No browser role receives
-- access to the underlying payment rows, emails, UUIDs or Stripe identifiers.
create or replace function public.get_garage_supporters(
  p_slug text,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table(display_name text, donation_count bigint, amount_cents bigint)
language sql stable security definer set search_path = '' as $$
  with eligible as (
    select
      coalesce('email:' || nullif(lower(btrim(d.donor_email)), ''), 'donation:' || d.id::text) as supporter_key,
      case when position('@' in coalesce(d.display_name, '')) > 0 then 'Supporter'
        else coalesce(nullif(btrim(d.display_name), ''), 'Anonymous') end as public_name,
      d.amount_cents - d.refunded_cents as net_cents,
      d.paid_at,
      d.id
    from public.donations d
    join public.projects p on p.id = d.project_id
    where p.slug = p_slug and p.is_published
      and d.status = 'paid' and d.is_public and not d.needs_review
      and d.currency = p.currency and d.refunded_cents < d.amount_cents
  ), supporters as (
    select
      e.supporter_key,
      (array_agg(e.public_name order by e.paid_at desc nulls last, e.id desc))[1] as public_name,
      count(*) as contribution_count,
      sum(e.net_cents)::bigint as total_cents,
      max(e.paid_at) as latest_at
    from eligible e
    group by e.supporter_key
  )
  select s.public_name, s.contribution_count, s.total_cents
  from supporters s
  order by s.total_cents desc, s.latest_at desc nulls last, s.supporter_key
  limit least(greatest(coalesce(p_limit, 100), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Deliberately public aggregate with the same consent/accounting gates as the
-- existing contribution feed; remove implicit defaults before the explicit grant.
revoke all on function public.get_garage_supporters(text, integer, integer) from public, anon, authenticated;
grant execute on function public.get_garage_supporters(text, integer, integer) to anon, authenticated, service_role;
