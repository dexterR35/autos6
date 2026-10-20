-- Public-read bucket for progress / part photos. Only project owners can write, and only
-- under a folder named after their project id: <project_id>/...
insert into storage.buckets (id, name, public)
values ('project-media', 'project-media', true)
on conflict (id) do nothing;

create or replace function public.is_project_admin_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folder text := split_part(p_name, '/', 1);
begin
  if v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.is_project_admin(v_folder::uuid);
end;
$$;
revoke execute on function public.is_project_admin_path(text) from public;
grant execute on function public.is_project_admin_path(text) to anon, authenticated;

create policy "Owners upload project media"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'project-media' and (select public.is_project_admin_path(name)));

create policy "Owners update project media"
  on storage.objects for update to authenticated
  using (bucket_id = 'project-media' and (select public.is_project_admin_path(name)))
  with check (bucket_id = 'project-media' and (select public.is_project_admin_path(name)));

create policy "Owners delete project media"
  on storage.objects for delete to authenticated
  using (bucket_id = 'project-media' and (select public.is_project_admin_path(name)));
