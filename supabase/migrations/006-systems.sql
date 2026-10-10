-- Atualização aditiva: executar antes de publicar a versão 0.6. Não apaga relatos.
begin;
alter table public.central_projects add column if not exists company text;
alter table public.central_projects add column if not exists allowed_emails text[] not null default '{}';
alter table public.central_projects add column if not exists restricted boolean not null default false;
alter table public.central_projects add column if not exists access_hash text;
alter table public.central_projects add column if not exists connected_at timestamptz;
create unique index if not exists central_projects_access on public.central_projects(access_hash) where access_hash is not null;
-- Preservar a regra RLS já usada: somente a API com service_role pode acessar os dados.
revoke all on public.central_projects from anon,authenticated;
grant all on public.central_projects to service_role;
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
commit;
