-- Project S6 core schema: public campaign content + private payment records.
-- Amounts are integer cents. Public content and private payment data live in separate
-- tables; visitors read campaign totals only through security-definer functions.

-- ---------------------------------------------------------------- helpers
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- projects
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,60}$'),
  title text not null check (char_length(title) between 1 and 80),
  tagline text check (char_length(tagline) <= 120),
  vehicle_display_name text check (char_length(vehicle_display_name) <= 120),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  goal_cents bigint not null check (goal_cents > 0),
  description text check (char_length(description) <= 5000),
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- parts
create table public.parts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9-]{1,60}$'), -- matches hotspot partId in src/data/views.js
  name text not null check (char_length(name) between 1 and 80),
  estimate_cents bigint not null check (estimate_cents >= 0),
  status text not null default 'needed' check (status in ('needed', 'upgrade', 'bought')),
  condition text check (char_length(condition) <= 80),
  description text check (char_length(description) <= 2000),
  thumbnail_url text check (char_length(thumbnail_url) <= 500),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, slug),
  unique (id, project_id) -- target for the donations composite FK
);
create index parts_project_sort_idx on public.parts (project_id, sort_order);
create trigger parts_updated_at before update on public.parts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- owners
create table public.project_admins (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_admins_user_idx on public.project_admins (user_id);

-- ---------------------------------------------------------------- updates
create table public.restoration_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 140),
  body text not null default '' check (char_length(body) <= 10000),
  image_urls text[] not null default '{}' check (cardinality(image_urls) <= 20),
  cost_cents bigint check (cost_cents is null or cost_cents >= 0),
  published_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index restoration_updates_project_pub_idx on public.restoration_updates (project_id, published_at desc);
create trigger restoration_updates_updated_at before update on public.restoration_updates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- donations (PRIVATE)
create table public.donations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete restrict,
  part_id uuid,
  attempt_id uuid not null unique, -- client-generated per checkout attempt (idempotency)
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'paid', 'failed', 'expired')),
  refunded_cents bigint not null default 0 check (refunded_cents >= 0),
  needs_review boolean not null default false, -- Stripe amount/currency mismatch
  donor_email text check (char_length(donor_email) <= 320),
  display_name text check (char_length(display_name) <= 40),
  is_public boolean not null default false,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint donations_refund_le_amount check (refunded_cents <= amount_cents),
  constraint donations_part_same_project foreign key (part_id, project_id)
    references public.parts (id, project_id) on delete set null (part_id)
);
create index donations_project_status_idx on public.donations (project_id, status);
create index donations_public_idx on public.donations (project_id, created_at desc) where status = 'paid' and is_public;
create trigger donations_updated_at before update on public.donations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- stripe events (PRIVATE)
create table public.stripe_events (
  event_id text primary key,
  type text not null,
  livemode boolean not null default false,
  donation_id uuid references public.donations (id) on delete set null,
  result text,
  received_at timestamptz not null default now()
);
