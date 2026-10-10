-- Executar no SQL Editor do Supabase. Pode ser executado novamente.
begin;
create table if not exists public.central_projects (
  id text primary key, name text not null, origins text[] not null default '{}',
  company text, allowed_emails text[] not null default '{}', restricted boolean not null default false,
  access_hash text, connected_at timestamptz
);
-- Compatibilidade ao executar setup sobre uma instalação anterior.
alter table public.central_projects add column if not exists company text;
alter table public.central_projects add column if not exists allowed_emails text[] not null default '{}';
alter table public.central_projects add column if not exists restricted boolean not null default false;
alter table public.central_projects add column if not exists access_hash text;
alter table public.central_projects add column if not exists connected_at timestamptz;
create unique index if not exists central_projects_access on public.central_projects(access_hash) where access_hash is not null;
create table if not exists public.central_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists public.central_reports (
  key text primary key check (key ~ '^[a-f0-9]{64}$'),
  project_id text not null references public.central_projects(id),
  report jsonb not null, attachments jsonb not null default '[]',
  digest text not null, sender_hash text not null,
  ready boolean not null default false,
  status text not null default 'novo' check (status in ('novo','em-analise','em-correcao','resolvido')),
  received_at timestamptz not null default now(), updated_at timestamptz
);
create index if not exists central_reports_received on public.central_reports(received_at desc);
create index if not exists central_reports_sender on public.central_reports(project_id, sender_hash, received_at);
alter table public.central_projects enable row level security;
alter table public.central_admins enable row level security;
alter table public.central_reports enable row level security;
-- Os navegadores não acessam estas tabelas diretamente. A API valida o login e
-- a lista de administradores antes de usar a chave secreta, exclusiva do servidor.
revoke all on public.central_projects, public.central_admins, public.central_reports from anon, authenticated;
grant all on public.central_projects, public.central_admins, public.central_reports to service_role;
create or replace view public.central_report_summaries with (security_invoker=true) as
select key,project_id,status,received_at,updated_at,
  jsonb_build_object('id',report->>'id','projectId',project_id,'type',report->>'type',
    'title',left(report->>'title',200),'description',left(report->>'description',500),'links','[]'::jsonb) as report,
  '[]'::jsonb as attachments,jsonb_array_length(attachments) as attachment_count,
  jsonb_array_length(report->'links') as link_count
from public.central_reports where ready;
revoke all on public.central_report_summaries from anon,authenticated;
grant select on public.central_report_summaries to service_role;
create or replace view public.central_report_stats with (security_invoker=true) as
select project_id,count(*)::int as total,
  count(*) filter(where status='novo')::int as new_count,
  count(*) filter(where status in ('em-analise','em-correcao'))::int as progress_count,
  count(*) filter(where status='resolvido')::int as resolved_count
from public.central_reports where ready group by project_id;
revoke all on public.central_report_stats from anon,authenticated;
grant select on public.central_report_stats to service_role;
create or replace function public.central_search(p_query text)
returns setof public.central_report_summaries language sql set search_path='' as $$
  select summary.* from public.central_report_summaries summary
  join public.central_reports full_report using(key)
  join public.central_projects project on project.id=full_report.project_id
  where position(lower(p_query) in lower(concat(full_report.report->>'title',' ',
    full_report.report->>'description',' ',full_report.project_id,' ',project.name,' ',project.company))) > 0;
$$;
revoke all on function public.central_search(text) from public,anon,authenticated;
grant execute on function public.central_search(text) to service_role;

insert into public.central_projects(id,name,origins) values
  ('central-demo','Central · Testes','{}'),
  ('radar-contratual','Radar Contratual',array['https://radarcontratual.com','https://www.radarcontratual.com'])
on conflict(id) do nothing;

-- Reserva idempotente e quotas persistentes, inclusive entre funções concorrentes.
create or replace function public.central_reserve(
  p_key text, p_project text, p_report jsonb, p_attachments jsonb, p_digest text, p_sender text
) returns setof public.central_reports language plpgsql set search_path = '' as $$
declare previous public.central_reports;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_project,0));
  select * into previous from public.central_reports where key=p_key;
  if found then
    if previous.digest <> p_digest then raise exception 'draft_conflict'; end if;
    return next previous; return;
  end if;
  if (select count(*) from public.central_reports where project_id=p_project
      and sender_hash=p_sender and received_at > now()-interval '10 minutes') >= 20
    or (select count(*) from public.central_reports where project_id=p_project
      and received_at > now()-interval '1 day') >= 500 then
    raise exception 'rate_limit';
  end if;
  return query insert into public.central_reports(key,project_id,report,attachments,digest,sender_hash)
    values(p_key,p_project,p_report,p_attachments,p_digest,p_sender) returning *;
end $$;
revoke all on function public.central_reserve(text,text,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.central_reserve(text,text,jsonb,jsonb,text,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('central-attachments','central-attachments',false,52428800,
  array['image/png','image/jpeg','image/webp','image/gif','image/avif'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;
-- Nenhuma policy pública de storage: upload e leitura usam URLs assinadas.
commit;
