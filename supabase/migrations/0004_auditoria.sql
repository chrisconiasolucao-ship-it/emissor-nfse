-- 0004 — trilha de auditoria (AT-028/G04) com hash encadeado (AT-034/G06), log de segurança (AT-033/G05),
-- âncora diária e avisos ao escritório.

create table public.auditoria (
  id bigint generated always as identity primary key,
  empresa_id uuid,
  quem uuid,
  quem_email text,
  quando timestamptz not null default clock_timestamp(),
  origem_ip inet,
  acao text not null,
  entidade text,
  entidade_id text,
  antes jsonb,
  depois jsonb,
  motivo text,
  hash_anterior char(64),
  hash char(64) not null default ''
);
create index auditoria_empresa on public.auditoria (empresa_id, quando);

-- Conteúdo canônico de uma linha (mesma fórmula na gravação e no verificador).
create or replace function app.auditoria_canonica(a public.auditoria) returns text
language sql immutable as $$
  select jsonb_build_object(
    'id', a.id, 'empresa_id', a.empresa_id, 'quem', a.quem, 'quem_email', a.quem_email,
    'quando', to_char(a.quando at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'origem_ip', a.origem_ip::text, 'acao', a.acao, 'entidade', a.entidade, 'entidade_id', a.entidade_id,
    'antes', a.antes, 'depois', a.depois, 'motivo', a.motivo
  )::text
$$;

create or replace function app.auditoria_hash(anterior text, a public.auditoria) returns char(64)
language sql immutable as $$
  select encode(extensions.digest(coalesce(anterior, '') || '|' || app.auditoria_canonica(a), 'sha256'), 'hex')
$$;

-- Encadeia: cada linha leva o hash da anterior. Serializado por trava de transação.
create or replace function app.trg_auditoria_encadear() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_anterior text;
begin
  perform pg_advisory_xact_lock(hashtext('public.auditoria.cadeia'));
  select hash into v_anterior from public.auditoria order by id desc limit 1;
  new.quando := clock_timestamp();
  new.hash_anterior := v_anterior;
  new.hash := app.auditoria_hash(v_anterior, new);
  return new;
end $$;
create trigger auditoria_encadear before insert on public.auditoria
  for each row execute function app.trg_auditoria_encadear();

-- Única porta de escrita na trilha (G04). Não é concedida a anon/authenticated.
create or replace function public.fn_auditar(
  p_empresa_id uuid, p_acao text, p_entidade text, p_entidade_id text,
  p_antes jsonb, p_depois jsonb, p_motivo text default null,
  p_quem uuid default null, p_ip inet default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_quem uuid; v_email text;
begin
  v_quem := coalesce(p_quem, auth.uid(), nullif(current_setting('app.quem', true), '')::uuid);
  select email into v_email from public.perfil_usuario where usuario_id = v_quem;
  insert into public.auditoria (empresa_id, quem, quem_email, origem_ip, acao, entidade, entidade_id, antes, depois, motivo)
  values (p_empresa_id, v_quem, v_email,
          coalesce(p_ip, nullif(current_setting('app.ip', true), '')::inet),
          p_acao, p_entidade, p_entidade_id, p_antes, p_depois,
          coalesce(p_motivo, nullif(current_setting('app.motivo', true), '')))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.fn_auditar(uuid, text, text, text, jsonb, jsonb, text, uuid, inet) from public, anon, authenticated;
grant execute on function public.fn_auditar(uuid, text, text, text, jsonb, jsonb, text, uuid, inet) to service_role;

-- Toda mudança nas tabelas de negócio entra na trilha, venha de onde vier (tela, servidor ou SQL).
create or replace function app.trg_auditar_mudanca() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_id text; v_antes jsonb; v_depois jsonb;
begin
  v_antes := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_depois := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  -- segredos nunca entram na trilha
  v_antes := v_antes - 'senha_cripto' - 'pfx_cripto';
  v_depois := v_depois - 'senha_cripto' - 'pfx_cripto';
  if tg_op = 'UPDATE' and (v_antes - 'atualizado_em') = (v_depois - 'atualizado_em') then
    return new;
  end if;
  v_empresa := coalesce((v_depois ->> 'empresa_id'), (v_antes ->> 'empresa_id'),
                        case when tg_table_name = 'empresa' then coalesce(v_depois ->> 'id', v_antes ->> 'id') end)::uuid;
  v_id := coalesce(v_depois ->> 'id', v_antes ->> 'id', v_depois ->> 'usuario_id', v_antes ->> 'usuario_id');
  perform public.fn_auditar(v_empresa, lower(tg_op) || ':' || tg_table_name, tg_table_name, v_id, v_antes, v_depois);
  return coalesce(new, old);
end $$;

create trigger auditar after insert or update or delete on public.empresa for each row execute function app.trg_auditar_mudanca();
create trigger auditar after insert or update or delete on public.perfil_usuario for each row execute function app.trg_auditar_mudanca();
create trigger auditar after insert or update or delete on public.tomador for each row execute function app.trg_auditar_mudanca();
create trigger auditar after insert or update or delete on public.servico for each row execute function app.trg_auditar_mudanca();
create trigger auditar after insert or update or delete on public.certificado for each row execute function app.trg_auditar_mudanca();
create trigger auditar after insert or update or delete on public.nota for each row execute function app.trg_auditar_mudanca();
create trigger auditar after insert on public.evento_nota for each row execute function app.trg_auditar_mudanca();
create trigger auditar after insert on public.documento for each row execute function app.trg_auditar_mudanca();
create trigger auditar after insert or update or delete on public.municipio_situacao for each row execute function app.trg_auditar_mudanca();

-- G06: recalcula a cadeia e devolve a primeira linha quebrada (null = íntegra).
create or replace function public.fn_verificar_auditoria(p_desde bigint default 0)
returns table (primeira_quebra bigint, ultimo_id bigint, ultimo_hash char(64))
language plpgsql security definer set search_path = public as $$
declare r public.auditoria; v_anterior text; v_quebra bigint; v_ult bigint; v_hash char(64);
begin
  if p_desde > 0 then
    select a.hash into v_anterior from public.auditoria a where a.id < p_desde order by a.id desc limit 1;
  end if;
  for r in select * from public.auditoria where id >= p_desde order by id loop
    -- linha alterada (hash não confere) ou linha removida no meio (elo não aponta para a anterior)
    if v_quebra is null and (r.hash_anterior is distinct from v_anterior or r.hash <> app.auditoria_hash(r.hash_anterior, r)) then
      v_quebra := r.id;
    end if;
    v_anterior := r.hash; v_ult := r.id; v_hash := r.hash;
  end loop;
  return query select v_quebra, v_ult, v_hash;
end $$;
revoke all on function public.fn_verificar_auditoria(bigint) from public, anon, authenticated;
grant execute on function public.fn_verificar_auditoria(bigint) to service_role;

-- AT-033 / G05: log de segurança separado da trilha de negócio.
create table public.log_seguranca (
  id bigint generated always as identity primary key,
  quando timestamptz not null default clock_timestamp(),
  usuario_id uuid,
  email text,
  ip inet,
  evento text not null check (evento in (
    'login_ok', 'login_falha', 'login_bloqueado', 'download_documento', 'exportacao',
    'uso_certificado', 'envio_certificado', 'acesso_negado')),
  empresa_id uuid,
  alvo text,
  detalhe jsonb
);
create index log_seguranca_quando on public.log_seguranca (quando);

create or replace function public.fn_log_seguranca(
  p_evento text, p_usuario uuid, p_email text, p_ip inet, p_empresa_id uuid, p_alvo text, p_detalhe jsonb default null
) returns bigint language sql security definer set search_path = public as $$
  insert into public.log_seguranca (evento, usuario_id, email, ip, empresa_id, alvo, detalhe)
  values (p_evento, p_usuario, p_email, p_ip, p_empresa_id, p_alvo, p_detalhe)
  returning id
$$;
revoke all on function public.fn_log_seguranca(text, uuid, text, inet, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_log_seguranca(text, uuid, text, inet, uuid, text, jsonb) to service_role;

-- Âncora diária e cópia do log fora do banco (Decision 7).
create table public.ancora_auditoria (
  dia date primary key,
  ultimo_id bigint,
  hash char(64),
  blob_url text,
  log_ate_id bigint,
  log_blob_url text,
  criado_em timestamptz not null default now()
);

-- Avisos ao escritório (emissões, cancelamentos e substituições de clientes; certificados; fila).
create table public.aviso (
  id bigint generated always as identity primary key,
  empresa_id uuid references public.empresa (id),
  tipo text not null check (tipo in (
    'emissao_cliente', 'cancelamento', 'substituicao', 'certificado_vencendo', 'certificado_invalido',
    'empresa_pausada', 'municipios_desatualizados', 'falha_copia', 'auditoria_quebrada')),
  nota_id uuid,
  mensagem text not null,
  quem uuid,
  quem_email text,
  quando timestamptz not null default now(),
  lido_em timestamptz,
  lido_por uuid
);
create index aviso_nao_lido on public.aviso (quando desc) where lido_em is null;

create or replace function public.fn_avisar(
  p_empresa_id uuid, p_tipo text, p_nota_id uuid, p_mensagem text, p_quem uuid default null
) returns bigint language sql security definer set search_path = public as $$
  insert into public.aviso (empresa_id, tipo, nota_id, mensagem, quem, quem_email)
  values (p_empresa_id, p_tipo, p_nota_id, p_mensagem, coalesce(p_quem, auth.uid()),
          (select email from public.perfil_usuario where usuario_id = coalesce(p_quem, auth.uid())))
  returning id
$$;
revoke all on function public.fn_avisar(uuid, text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.fn_avisar(uuid, text, uuid, text, uuid) to service_role;
