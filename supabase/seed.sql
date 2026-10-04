-- Campaign content seed (no donations, no supporters, no progress claims).
-- Run after the migrations: supabase db reset (local) or paste into the SQL editor.
insert into public.projects (slug, title, tagline, vehicle_display_name, currency, goal_cents, description)
values (
  'project-s6', 'PROJECT S6', 'MAKE THIS CAR GREAT AGAIN', 'AUDI S6 C5 AVANT 2.7 BiTurbo (2003)', 'usd', 800000,
  'A long-term restoration of a C5-generation Audi S6 Avant. Contributions go toward parts, paint and labour, one job at a time.'
)
on conflict (slug) do nothing;

insert into public.parts (project_id, slug, name, estimate_cents, status, condition, description, sort_order)
select p.id, v.slug, v.name, v.estimate_cents, v.status, v.condition, v.description, v.sort_order
from public.projects p
cross join (values
  ('front-bumper', 'Front Bumper', 80000, 'needed', 'Scratched', 'Original bumper cover is scratched and scuffed. Plan: repair, prime and paint to match.', 0),
  ('hood', 'Hood', 65000, 'needed', 'Needs paint', 'Clear coat failure on the hood. Plan: strip, prep and respray.', 1),
  ('wheels', 'Wheels (OEM+)', 120000, 'upgrade', 'Optional upgrade', 'OEM-style wheel refresh or upgrade. Optional — only after the essentials are done.', 2),
  ('side-skirts', 'Side Skirts', 45000, 'needed', 'Missing', 'Side skirt trim is missing and needs to be sourced and fitted.', 3),
  ('rear-bumper', 'Rear Bumper', 70000, 'needed', 'Needs restoration', 'Rear bumper cover needs repair and refinishing.', 4),
  ('exhaust', 'Exhaust System', 95000, 'needed', 'Needs replacement', 'Exhaust needs replacement. Quad-tip layout to be retained.', 5),
  ('coilovers', 'Coilovers (Suspension)', 120000, 'needed', 'Needs replacement', 'Worn suspension to be replaced with a quality coilover kit.', 6),
  ('brake-kit', 'Brake Kit', 140000, 'upgrade', 'Optional upgrade', 'Optional brake upgrade for the front axle.', 7),
  ('roof-box', 'Roof Box', 45000, 'bought', 'Purchased', 'Roof box already purchased and fitted.', 8),
  ('interior', 'Interior Refresh', 60000, 'needed', 'Needs restoration', 'Seats, trim and carpets need cleaning and repair.', 9)
) as v(slug, name, estimate_cents, status, condition, description, sort_order)
where p.slug = 'project-s6'
on conflict (project_id, slug) do nothing;

-- Owner provisioning (trusted step — run in the SQL editor after the owner signs up):
-- insert into public.project_admins (project_id, user_id)
-- select p.id, u.id from public.projects p, auth.users u
-- where p.slug = 'project-s6' and u.email = 'owner@example.com';
