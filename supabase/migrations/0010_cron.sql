-- 0010 — agendamento dos workers (Decision 3). pg_cron chama a Vercel por pg_net.
-- Segredos NÃO ficam aqui: cadastre no Vault (README):
--   select vault.create_secret('https://<seu-app>.vercel.app', 'app_url');
--   select vault.create_secret('<mesmo WORKER_SECRET da Vercel>', 'worker_secret');

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function app.chamar_worker(p_rota text, p_timeout_ms integer default 60000)
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare v_url text; v_segredo text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'worker_secret';
  if v_url is null or v_segredo is null then
    raise warning 'app_url/worker_secret não cadastrados no Vault; worker % não chamado', p_rota;
    return null;
  end if;
  return net.http_post(
    url := v_url || p_rota,
    headers := jsonb_build_object('content-type', 'application/json', 'x-worker-secret', v_segredo),
    body := '{}'::jsonb,
    timeout_milliseconds := p_timeout_ms);
end $$;
revoke all on function app.chamar_worker(text, integer) from public, anon, authenticated;

-- a cada minuto: fila de emissão
select cron.schedule('emissor-emitir', '* * * * *', $$select app.chamar_worker('/api/worker/emitir', 60000)$$);
-- 06:00 BRT (09:00 UTC): distribuição ADN
select cron.schedule('emissor-adn', '0 9 * * *', $$select app.chamar_worker('/api/worker/adn', 300000)$$);
-- 00:10 BRT (03:10 UTC): alertas de certificado, verificador, âncora e cópia do log
select cron.schedule('emissor-diario', '10 3 * * *', $$select app.chamar_worker('/api/worker/diario', 300000)$$);
