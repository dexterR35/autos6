-- Cover foreign keys used during parent updates/deletes, including unpaid rows.
create index donations_part_project_idx on public.donations(part_id,project_id);
create index email_jobs_subscriber_idx on public.email_jobs(subscriber_id);
create index restoration_updates_author_idx on public.restoration_updates(created_by);
create index stripe_events_donation_idx on public.stripe_events(donation_id);
create index subscribers_part_idx on public.subscribers(part_id);

-- Preserve the existing published-or-owner rule with one SELECT policy.
drop policy "Published updates are public" on public.restoration_updates;
drop policy "Owners read all their updates" on public.restoration_updates;
create policy "Published updates or project owner" on public.restoration_updates
  for select to anon,authenticated using (
    (published_at is not null and published_at <= now()
      and exists(select 1 from public.projects p where p.id=project_id and p.is_published))
    or (select public.is_project_admin(project_id))
  );

-- This helper is called only by authenticated storage write/list policies.
revoke execute on function public.is_project_admin_path(text) from anon;
