-- Web Push: somente a API com service_role acessa estes dados.
begin;
create table if not exists public.central_push_config (
  id boolean primary key default true check(id),
  public_key text not null, private_key text not null, dispatch_token text not null,
  origin text not null
);
create table if not exists public.central_push_events (
  id bigint generated always as identity primary key,
  report_key text not null unique references public.central_reports(key) on delete cascade,
  project_id text not null references public.central_projects(id) on delete cascade,
  confirmed_at timestamptz not null default now()
);
create table if not exists public.central_push_devices (
  id text primary key check(id ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references public.central_admins(user_id) on delete cascade,
  subscription jsonb not null,
  system_ids text[],
  seen_id bigint not null default 0, delivered_id bigint not null default 0,
  lease_until timestamptz,
  updated_at timestamptz not null default now(),
  check(system_ids is null or cardinality(system_ids) between 1 and 100)
);
create index if not exists central_push_devices_user on public.central_push_devices(user_id);
create index if not exists central_push_events_project on public.central_push_events(project_id,id);
alter table public.central_push_config enable row level security;
alter table public.central_push_events enable row level security;
alter table public.central_push_devices enable row level security;
revoke all on public.central_push_config,public.central_push_events,public.central_push_devices from anon,authenticated;
grant all on public.central_push_config,public.central_push_events,public.central_push_devices to service_role;
grant usage,select on sequence public.central_push_events_id_seq to service_role;

create or replace function public.central_push_enqueue() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.ready and (tg_op='INSERT' or not old.ready) then
    -- ponytail: serializar eventos até o commit; usar fila particionada se este lock limitar o volume.
    perform pg_catalog.pg_advisory_xact_lock(71402261);
    insert into public.central_push_events(report_key,project_id) values(new.key,new.project_id)
      on conflict(report_key) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.central_push_enqueue() from public,anon,authenticated;
grant execute on function public.central_push_enqueue() to service_role;
drop trigger if exists central_push_enqueue on public.central_reports;
create trigger central_push_enqueue after insert or update of ready on public.central_reports
  for each row execute function public.central_push_enqueue();

create or replace function public.central_push_summary(p_device text) returns jsonb
language sql set search_path='' as $$
  with grouped as (
    select e.project_id,p.name,count(*)::int as amount,max(e.id) as latest
    from public.central_push_devices d
    join public.central_push_events e on e.id>d.seen_id
    join public.central_projects p on p.id=e.project_id
    join public.central_admins a on a.user_id=d.user_id
    where d.id=p_device and (a.is_primary or p.owner_id=d.user_id or d.user_id=any(p.supervisor_ids))
      and (d.system_ids is null or e.project_id=any(d.system_ids))
    group by e.project_id,p.name
  )
  select jsonb_build_object(
    'cursor',coalesce((select max(id) from public.central_push_events),0),
    'total',coalesce(sum(amount),0),
    'pending',coalesce(max(latest)>(select delivered_id from public.central_push_devices where id=p_device),false),
    'systems',coalesce(jsonb_agg(jsonb_build_object('id',project_id,'name',name,'count',amount) order by name),'[]'::jsonb)
  ) from grouped;
$$;
create or replace function public.central_push_claim() returns setof public.central_push_devices
language sql set search_path='' as $$
  update public.central_push_devices d set lease_until=now()+interval '2 minutes'
  where d.id in (
    select x.id from public.central_push_devices x
    where (x.lease_until is null or x.lease_until<now()) and exists(
      select 1 from public.central_push_events e
      join public.central_projects p on p.id=e.project_id
      join public.central_admins a on a.user_id=x.user_id
      where (a.is_primary or p.owner_id=x.user_id or x.user_id=any(p.supervisor_ids))
        and e.id>greatest(x.delivered_id,x.seen_id) and (x.system_ids is null or e.project_id=any(x.system_ids))
    ) order by x.updated_at limit 100 for update skip locked
  ) returning d.*;
$$;
create or replace function public.central_push_ack(p_user uuid,p_cursor bigint) returns void
language sql set search_path='' as $$
  update public.central_push_devices set seen_id=greatest(seen_id,least(p_cursor,coalesce((select max(id) from public.central_push_events),0))),updated_at=now()
  where user_id=p_user;
$$;
create or replace function public.central_push_register(p_user uuid,p_id text,p_subscription jsonb,p_system_ids text[]) returns void
language plpgsql set search_path='' as $$
declare latest bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(71402262,pg_catalog.hashtext(p_user::text));
  if not exists(select 1 from public.central_push_devices where id=p_id and user_id=p_user)
    and (select count(*) from public.central_push_devices where user_id=p_user)>=10 then
    raise exception 'device_limit';
  end if;
  select coalesce(max(id),0) into latest from public.central_push_events;
  insert into public.central_push_devices(id,user_id,subscription,system_ids,seen_id,delivered_id)
    values(p_id,p_user,p_subscription,p_system_ids,latest,latest)
  on conflict(id) do update set user_id=excluded.user_id,subscription=excluded.subscription,system_ids=excluded.system_ids,
    seen_id=case when public.central_push_devices.user_id=p_user then public.central_push_devices.seen_id else latest end,
    delivered_id=latest,lease_until=null,updated_at=now();
end;
$$;
revoke all on function public.central_push_summary(text),public.central_push_claim(),public.central_push_ack(uuid,bigint),public.central_push_register(uuid,text,jsonb,text[]) from public,anon,authenticated;
grant execute on function public.central_push_summary(text),public.central_push_claim(),public.central_push_ack(uuid,bigint),public.central_push_register(uuid,text,jsonb,text[]) to service_role;
commit;
