-- 0008 — fila de emissão (Decision 3 e 4, AT-005 a AT-009).

-- Um worker por vez: concessão com prazo (funciona com conexões em pool).
create table public.worker_lease (
  nome text primary key,
  ate timestamptz not null default 'epoch',
  dono text
);
alter table public.worker_lease enable row level security;
insert into public.worker_lease (nome) values ('emitir'), ('adn'), ('diario') on conflict do nothing;

create or replace function public.fn_adquirir_lease(p_nome text, p_segundos integer, p_dono text)
returns boolean language sql security definer set search_path = public as $$
  update public.worker_lease set ate = now() + make_interval(secs => p_segundos), dono = p_dono
   where nome = p_nome and ate < now()
  returning true
$$;

create or replace function public.fn_liberar_lease(p_nome text, p_dono text)
returns void language sql security definer set search_path = public as $$
  update public.worker_lease set ate = 'epoch' where nome = p_nome and dono = p_dono
$$;

-- Numeração da DPS: série própria da empresa, número sequencial, id de 45 posições.
-- DPS + cMun(7) + tpInsc(1: 2 = CNPJ) + CNPJ(14) + série(5) + nDPS(15)
create or replace function app.montar_id_dps(p_cod_municipio text, p_cnpj text, p_serie text, p_numero bigint)
returns varchar(45) language sql immutable as $$
  select ('DPS' || p_cod_municipio || '2' || p_cnpj || lpad(p_serie, 5, '0') || lpad(p_numero::text, 15, '0'))::varchar(45)
$$;

-- Pega a próxima nota pronta, marca 'enviando' e numera (uma vez só: a nova tentativa usa o mesmo número).
create or replace function public.fn_pegar_proxima_nota()
returns setof public.nota language plpgsql security definer set search_path = public as $$
declare v public.nota; e public.empresa; v_num bigint;
begin
  select n.* into v from public.nota n
    join public.empresa em on em.id = n.empresa_id
   where n.situacao = 'na_fila'
     and (n.proxima_tentativa_em is null or n.proxima_tentativa_em <= now())
     and not em.pausada and em.ativa
   order by n.proxima_tentativa_em nulls first, n.enfileirada_em
   for update of n skip locked
   limit 1;
  if not found then
    return;
  end if;
  if v.numero_dps is null then
    update public.empresa set proximo_ndps = proximo_ndps + 1 where id = v.empresa_id
      returning * into e;
    v_num := e.proximo_ndps - 1;
    update public.nota set serie_dps = e.serie_dps, numero_dps = v_num,
           id_dps = app.montar_id_dps(e.cod_municipio, e.cnpj, e.serie_dps, v_num)
     where empresa_id = v.empresa_id and id = v.id;
  end if;
  return query
    update public.nota set situacao = 'enviando' where empresa_id = v.empresa_id and id = v.id returning *;
end $$;

-- Falha técnica: nova tentativa em 5/15/60 min; esgotou ⇒ rejeitada "Receita indisponível" (AT-005).
create or replace function public.fn_reagendar(p_empresa_id uuid, p_id uuid, p_erro text, p_minutos integer[])
returns public.situacao_nota language plpgsql security definer set search_path = public as $$
declare v_tent smallint; v_sit public.situacao_nota;
begin
  select tentativas + 1 into v_tent from public.nota where empresa_id = p_empresa_id and id = p_id for update;
  if v_tent > coalesce(array_length(p_minutos, 1), 0) then
    update public.nota set situacao = 'rejeitada', tentativas = v_tent, proxima_tentativa_em = null,
           codigo_rejeicao = 'INDISPONIVEL', motivo_rejeicao = 'Receita indisponível: ' || left(p_erro, 300)
     where empresa_id = p_empresa_id and id = p_id returning situacao into v_sit;
  else
    update public.nota set situacao = 'na_fila', tentativas = v_tent,
           proxima_tentativa_em = now() + make_interval(mins => p_minutos[v_tent]),
           motivo_rejeicao = 'Nova tentativa: ' || left(p_erro, 300)
     where empresa_id = p_empresa_id and id = p_id returning situacao into v_sit;
  end if;
  return v_sit;
end $$;

-- Erro de banco ou do worker no meio: devolve para a fila sem contar tentativa.
create or replace function public.fn_devolver_para_fila(p_empresa_id uuid, p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.nota set situacao = 'na_fila' where empresa_id = p_empresa_id and id = p_id and situacao = 'enviando'
$$;

-- Rejeição por dado ou regra de município: sem nova tentativa (AT-002, AT-003, AT-006).
create or replace function public.fn_marcar_rejeitada(p_empresa_id uuid, p_id uuid, p_codigo text, p_motivo text)
returns void language sql security definer set search_path = public as $$
  update public.nota set situacao = 'rejeitada', codigo_rejeicao = p_codigo, motivo_rejeicao = p_motivo,
         proxima_tentativa_em = null
   where empresa_id = p_empresa_id and id = p_id and situacao = 'enviando'
$$;

create or replace function public.fn_marcar_autorizada(
  p_empresa_id uuid, p_id uuid, p_chave text, p_numero_nfse text, p_autorizada_em timestamptz,
  p_documento_id uuid, p_danfse_documento_id uuid
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.nota set situacao = 'autorizada', chave_acesso = p_chave, numero_nfse = p_numero_nfse,
         autorizada_em = p_autorizada_em, documento_id = p_documento_id, danfse_documento_id = p_danfse_documento_id,
         codigo_rejeicao = null, motivo_rejeicao = null, proxima_tentativa_em = null
   where empresa_id = p_empresa_id and id = p_id and situacao = 'enviando';
  if not found then
    raise exception 'nota % não estava em envio', p_id using errcode = 'P0001';
  end if;
end $$;

-- DANFSe baixado depois (a nota já está autorizada e imutável): o documento aponta para a nota
-- (documento.nota_id, tipo 'danfse'); a nota não muda.

-- Certificado vencido ou senha errada: pausa a empresa inteira e avisa o escritório (AT-007).
create or replace function public.fn_pausar_empresa(p_empresa_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.empresa set pausada = true, motivo_pausa = p_motivo where id = p_empresa_id and not pausada;
  if found then
    perform public.fn_avisar(p_empresa_id, 'empresa_pausada', null, 'Emissão pausada: ' || p_motivo, null);
  end if;
end $$;

create or replace function public.fn_retomar_empresa(p_empresa_id uuid, p_quem uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.quem', p_quem::text, true);
  update public.empresa set pausada = false, motivo_pausa = null where id = p_empresa_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'fn_adquirir_lease(text, integer, text)', 'fn_liberar_lease(text, text)', 'fn_pegar_proxima_nota()',
    'fn_reagendar(uuid, uuid, text, integer[])', 'fn_devolver_para_fila(uuid, uuid)',
    'fn_marcar_rejeitada(uuid, uuid, text, text)',
    'fn_marcar_autorizada(uuid, uuid, text, text, timestamptz, uuid, uuid)',
    'fn_pausar_empresa(uuid, text)', 'fn_retomar_empresa(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
