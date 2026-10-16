-- Reserva durável antes do POST ao GitHub. Nenhum segredo ou texto do relato nesta tabela.
begin;
create table if not exists public.central_bug_fix_jobs (
  fingerprint text primary key check (fingerprint ~ '^[a-f0-9]{64}$'),
  report_key text references public.central_reports(key) on delete set null,
  project_id text not null references public.central_projects(id) on delete cascade,
  repository text not null,
  state text not null default 'creating' check (state in ('creating','queued','failed','uncertain')),
  issue_number bigint,
  created_at timestamptz not null default now()
);
create index if not exists central_bug_fix_report on public.central_bug_fix_jobs(report_key);
create index if not exists central_bug_fix_quota on public.central_bug_fix_jobs(repository,created_at);
alter table public.central_bug_fix_jobs enable row level security;
revoke all on public.central_bug_fix_jobs from public,anon,authenticated;
grant select,insert,update,delete on public.central_bug_fix_jobs to service_role;
create or replace function public.central_claim_bug_fix(p_key text,p_repository text,p_fingerprint text)
returns table(fingerprint text,report_key text,repository text,state text,issue_number bigint,claimed boolean)
language plpgsql set search_path='' as $$
declare source public.central_reports; previous public.central_bug_fix_jobs;
begin
  if p_repository !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' then raise exception 'invalid_repository'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lower(p_repository),1));
  select * into source from public.central_reports r where r.key=p_key and r.ready
    and r.report->>'type'='bug' and r.report->'autoFix'='true'::jsonb;
  if not found then raise exception 'invalid_report'; end if;
  select * into previous from public.central_bug_fix_jobs j where j.fingerprint=p_fingerprint;
  if found then
    return query select previous.fingerprint,previous.report_key,previous.repository,previous.state,previous.issue_number,false;
    return;
  end if;
  if (select count(*) from public.central_bug_fix_jobs j where j.project_id=source.project_id and j.created_at>now()-interval '1 day')>=5
    or (select count(*) from public.central_bug_fix_jobs j where lower(j.repository)=lower(p_repository) and j.created_at>now()-interval '1 day')>=20 then return; end if;
  insert into public.central_bug_fix_jobs(fingerprint,report_key,project_id,repository)
    values(p_fingerprint,p_key,source.project_id,p_repository) returning * into previous;
  return query select previous.fingerprint,previous.report_key,previous.repository,previous.state,previous.issue_number,true;
end $$;
revoke all on function public.central_claim_bug_fix(text,text,text) from public,anon,authenticated;
grant execute on function public.central_claim_bug_fix(text,text,text) to service_role;
commit;
