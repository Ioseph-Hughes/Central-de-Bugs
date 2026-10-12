-- Executar depois da migração de Web Push. Não precisa de uma chave secreta no cron.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule('central-push-every-minute','* * * * *',$job$
  select net.http_post(
    url:=c.origin || '/api/notifications?action=dispatch',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || c.dispatch_token),
    body:='{}'::jsonb,timeout_milliseconds:=55000
  ) from public.central_push_config c
  where exists (
    select 1 from public.central_push_devices d join public.central_push_events e on e.id>greatest(d.delivered_id,d.seen_id)
    where (d.lease_until is null or d.lease_until<now()) and (d.system_ids is null or e.project_id=any(d.system_ids))
  );
$job$);
