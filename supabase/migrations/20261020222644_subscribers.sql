-- Email addresses, consent and delivery records are service-role only.
create table public.subscribers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  email text not null check (char_length(email) <= 254),
  part_id uuid references public.parts(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','active','unsubscribed')),
  token_hash text unique,
  token_expires_at timestamptz,
  consent_version text not null,
  consent_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  requested_at timestamptz not null default now(),
  unique(project_id,email)
);
create table public.email_jobs (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  kind text not null check (kind in ('confirmation','update')),
  payload jsonb not null,
  unique_key text not null unique,
  state text not null default 'pending' check (state in ('pending','sending','sent','cancelled','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_id uuid,
  leased_at timestamptz,
  sent_at timestamptz,
  provider_id text,
  created_at timestamptz not null default now()
);
create index email_jobs_pending_idx on public.email_jobs(available_at) where state in ('pending','sending');
alter table public.subscribers enable row level security;
alter table public.email_jobs enable row level security;
revoke all on public.subscribers, public.email_jobs from public,anon,authenticated;
grant all on public.subscribers, public.email_jobs to service_role;

create function public.request_subscription(p_slug text,p_email text,p_part_slug text,p_hash text,p_url text,p_consent text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_project uuid; v_part uuid; s public.subscribers%rowtype;
begin
  select id into v_project from public.projects where slug=p_slug and is_published;
  if v_project is null then raise exception 'project_not_found'; end if;
  if p_consent is distinct from '2026-10-21' then raise exception 'consent_required'; end if;
  if p_part_slug is not null then
    select id into v_part from public.parts where project_id=v_project and slug=p_part_slug;
    if v_part is null then raise exception 'part_not_found'; end if;
  end if;
  insert into public.subscribers(project_id,email,part_id,token_hash,token_expires_at,consent_version)
    values(v_project,lower(p_email),v_part,p_hash,now()+interval '24 hours',p_consent)
    on conflict(project_id,email) do nothing;
  select * into s from public.subscribers where project_id=v_project and email=lower(p_email) for update;
  -- A stranger cannot overwrite an active member's preferences or spam their inbox.
  if s.status='active' then return; end if;
  if s.token_hash is distinct from p_hash and s.requested_at > now()-interval '1 hour' then return; end if;
  update public.subscribers set status='pending',part_id=v_part,token_hash=p_hash,
    token_expires_at=now()+interval '24 hours',requested_at=now(),consent_version=p_consent,consent_at=now()
    where id=s.id;
  insert into public.email_jobs(subscriber_id,kind,payload,unique_key)
    values(s.id,'confirmation',jsonb_build_object('url',p_url),'confirm-'||p_hash);
end;
$$;

create function public.confirm_subscription(p_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.subscribers set status='active',confirmed_at=now(),unsubscribed_at=null,token_hash=null,token_expires_at=null
    where token_hash=p_hash and status='pending' and token_expires_at>now();
  return found;
end;
$$;

create function public.unsubscribe_member(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.subscribers set status='unsubscribed',unsubscribed_at=now(),token_hash=null,token_expires_at=null where id=p_id;
  update public.email_jobs set state='cancelled' where subscriber_id=p_id and state in ('pending','sending');
end;
$$;

create function public.queue_project_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_title text; v_body text; v_part uuid; v_event text; v_path text;
begin
  if tg_table_name='parts' then
    if tg_op='UPDATE' and (new.name,new.estimate_cents,new.status,new.description,new.priority,new.condition,new.thumbnail_url)
      is not distinct from (old.name,old.estimate_cents,old.status,old.description,old.priority,old.condition,old.thumbnail_url) then return new; end if;
    v_part:=new.id; v_title:='Part update: '||new.name;
    v_body:=new.name||' · '||new.status||' · Goal $'||to_char(new.estimate_cents/100.0,'FM999999990.00')||E'\n'||coalesce(new.description,'');
    v_path:='/parts';
  else
    if new.published_at is null or new.published_at>now() then return new; end if;
    if tg_op='UPDATE' and (new.title,new.body,new.published_at) is not distinct from (old.title,old.body,old.published_at) then return new; end if;
    v_title:=new.title; v_body:=left(new.body,1500); v_path:='/progress';
  end if;
  if not exists(select 1 from public.projects where id=new.project_id and is_published) then return new; end if;
  v_event:=gen_random_uuid()::text;
  insert into public.email_jobs(subscriber_id,kind,payload,unique_key)
    select s.id,'update',jsonb_build_object('title',v_title,'body',v_body,'path',v_path),v_event||'-'||s.id
    from public.subscribers s where s.project_id=new.project_id and s.status='active'
      and (s.part_id is null or v_part is null or s.part_id=v_part);
  return new;
end;
$$;
create trigger notify_part_change after insert or update on public.parts for each row execute function public.queue_project_notification();
create trigger notify_project_update after insert or update on public.restoration_updates for each row execute function public.queue_project_notification();

create function public.claim_email_jobs(p_limit integer default 20)
returns table(id uuid,subscriber_id uuid,email text,kind text,payload jsonb,lease_id uuid,attempts integer)
language plpgsql security definer set search_path = '' as $$
begin
  -- Retry leases for at most 12 hours, within the provider's idempotency window.
  update public.email_jobs set state='failed' where state in ('pending','sending') and created_at<now()-interval '12 hours';
  update public.email_jobs j set state='cancelled' from public.subscribers s where s.id=j.subscriber_id
    and j.state in ('pending','sending') and (s.status='unsubscribed' or (j.kind='confirmation' and (s.status<>'pending' or s.token_expires_at<now() or j.unique_key<>'confirm-'||s.token_hash)));
  return query
    with ready as (
      select j.id from public.email_jobs j where j.available_at<=now() and j.attempts<8
        and (j.state='pending' or (j.state='sending' and j.leased_at<now()-interval '5 minutes'))
      order by j.available_at for update skip locked limit least(greatest(p_limit,1),50)
    ), claimed as (
      update public.email_jobs j set state='sending',leased_at=now(),lease_id=gen_random_uuid(),attempts=j.attempts+1
        from ready r where j.id=r.id returning j.*
    ) select c.id,c.subscriber_id,s.email,c.kind,c.payload,c.lease_id,c.attempts
      from claimed c join public.subscribers s on s.id=c.subscriber_id;
end;
$$;
create function public.finish_email_job(p_id uuid,p_lease uuid,p_provider text)
returns void language sql security definer set search_path = '' as $$
  update public.email_jobs set state=case when p_provider is not null then 'sent' when attempts>=8 then 'failed' else 'pending' end,
    provider_id=p_provider,sent_at=case when p_provider is not null then now() end,
    available_at=now()+interval '5 minutes',payload=case when p_provider is not null then '{}'::jsonb else payload end
    where id=p_id and lease_id=p_lease and state='sending';
$$;

revoke all on function public.request_subscription(text,text,text,text,text,text),public.confirm_subscription(text),public.unsubscribe_member(uuid),public.queue_project_notification(),public.claim_email_jobs(integer),public.finish_email_job(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.request_subscription(text,text,text,text,text,text),public.confirm_subscription(text),public.unsubscribe_member(uuid),public.claim_email_jobs(integer),public.finish_email_job(uuid,uuid,text) to service_role;
