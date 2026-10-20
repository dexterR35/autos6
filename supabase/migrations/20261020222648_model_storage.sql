-- Public delivery for the website's 3D assets, owner-only mutation. Keep Blender
-- sources outside this bucket. Folder convention: <project UUID>/<version>/file.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('project-models','project-models',true,26214400,
  array['model/gltf-binary','application/octet-stream','image/vnd.radiance']::text[])
on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy "Owners upload project models" on storage.objects for insert to authenticated
  with check(bucket_id='project-models' and public.is_project_admin_path(name));
create policy "Owners update project models" on storage.objects for update to authenticated
  using(bucket_id='project-models' and public.is_project_admin_path(name))
  with check(bucket_id='project-models' and public.is_project_admin_path(name));
create policy "Owners delete project models" on storage.objects for delete to authenticated
  using(bucket_id='project-models' and public.is_project_admin_path(name));
create policy "Owners list their project models" on storage.objects for select to authenticated
  using(bucket_id='project-models' and public.is_project_admin_path(name));
