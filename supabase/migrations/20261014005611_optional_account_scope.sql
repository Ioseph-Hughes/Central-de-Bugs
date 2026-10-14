-- Opção explícita; cadastros existentes conservam sua política de acesso.
begin;
alter table public.central_projects add column if not exists all_accounts boolean not null default false;
commit;
