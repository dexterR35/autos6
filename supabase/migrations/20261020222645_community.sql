create table public.community_posts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.community_posts(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 40),
  category text not null check (category in ('help','parts','builds','general')),
  title text not null check (char_length(title) between 3 and 140),
  body text not null check (char_length(body) between 10 and 4000),
  status text not null default 'pending' check (status in ('pending','approved','hidden')),
  consent_version text not null,
  created_at timestamptz not null default now()
);
create index community_project_feed_idx on public.community_posts(project_id,created_at desc);
create index community_author_idx on public.community_posts(author_id,created_at desc);
create index community_parent_idx on public.community_posts(parent_id);
alter table public.community_posts enable row level security;
revoke all on public.community_posts from public,anon,authenticated;
grant select on public.community_posts to anon,authenticated;
grant update(status) on public.community_posts to authenticated;
grant all on public.community_posts to service_role;
create policy "Community visibility" on public.community_posts for select to anon,authenticated using (
  exists(select 1 from public.projects p where p.id=project_id and p.is_published)
  and (status='approved' or author_id=(select auth.uid()) or public.is_project_admin(project_id))
);
create policy "Owners moderate community" on public.community_posts for update to authenticated
  using (public.is_project_admin(project_id)) with check(public.is_project_admin(project_id));

create function public.create_community_post(p_slug text,p_parent uuid,p_name text,p_category text,p_title text,p_body text,p_consent text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_project uuid; v_user uuid := auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception 'Sign in to post.'; end if;
  if not exists(select 1 from auth.users where id=v_user and email_confirmed_at is not null) then raise exception 'Confirm your email before posting.'; end if;
  if p_consent is distinct from '2026-10-21' then raise exception 'Please accept the community guidelines.'; end if;
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
revoke all on function public.create_community_post(text,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.create_community_post(text,uuid,text,text,text,text,text) to authenticated;
