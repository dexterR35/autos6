-- Trusted, expiring owner invitations. No email allowlist is exposed by the API.
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
create table private.project_owner_invitations (
  project_id uuid not null references public.projects(id) on delete cascade,
  email text not null check(email=lower(btrim(email)) and char_length(email) between 3 and 320),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key(project_id,email)
);
alter table private.project_owner_invitations enable row level security;
revoke all on private.project_owner_invitations from public,anon,authenticated;

create function private.accept_project_owner_invitation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.email_confirmed_at is null or new.email is null then return new; end if;
  with accepted as (
    delete from private.project_owner_invitations i
    where i.email=lower(btrim(new.email)) and i.expires_at>now()
    returning i.project_id
  )
  insert into public.project_admins(project_id,user_id)
    select a.project_id,new.id from accepted a on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.accept_project_owner_invitation() from public,anon,authenticated;
create trigger accept_project_owner_invitation
  after insert or update of email,email_confirmed_at on auth.users
  for each row execute function private.accept_project_owner_invitation();
