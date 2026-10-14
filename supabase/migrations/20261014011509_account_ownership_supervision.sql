-- Contas independentes; a principal pode supervisionar e compartilhar sistemas.
begin;
alter table public.central_admins add column if not exists is_primary boolean not null default false;
create unique index if not exists central_primary_account on public.central_admins(is_primary) where is_primary;
alter table public.central_projects add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table public.central_projects add column if not exists supervisor_ids uuid[] not null default '{}';
create index if not exists central_projects_owner on public.central_projects(owner_id);

-- A identidade vem do Auth; nunca de metadados editáveis pelo navegador.
update public.central_admins a set is_primary=true
from auth.users u where u.id=a.user_id and lower(u.email)='abelcamargoo99@gmail.com';
update public.central_projects set owner_id=(select user_id from public.central_admins where is_primary)
where owner_id is null;

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
revoke all on function public.central_push_summary(text),public.central_push_claim() from public,anon,authenticated;
grant execute on function public.central_push_summary(text),public.central_push_claim() to service_role;
commit;
