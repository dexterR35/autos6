-- Keep the public campaign definition consistent with its fixed USD target.
alter table public.projects add constraint project_s6_fixed_goal
  check (slug <> 'project-s6' or (currency='usd' and goal_cents=1000000));

-- Storage enforces this even if an owner bypasses the upload form.
update storage.buckets set file_size_limit=5242880,
  allowed_mime_types=array['image/jpeg','image/png','image/webp']::text[]
  where id='project-media';

-- Public support rows follow the same accounting rules as the campaign aggregate.
create or replace function public.get_public_contributions(p_slug text,p_limit integer default 50)
returns table(display_name text,amount_cents bigint,part_name text,created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select nullif(btrim(d.display_name),''),d.amount_cents-d.refunded_cents,pt.name,d.paid_at
  from public.donations d join public.projects p on p.id=d.project_id
  left join public.parts pt on pt.id=d.part_id
  where p.slug=p_slug and p.is_published and d.status='paid' and d.is_public
    and not d.needs_review and d.currency=p.currency and d.refunded_cents<d.amount_cents
  order by d.paid_at desc nulls last limit least(greatest(coalesce(p_limit,50),1),100);
$$;
