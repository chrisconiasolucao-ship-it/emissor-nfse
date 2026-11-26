-- 0005 — travas que valem para qualquer papel, inclusive o dono das tabelas.
-- G01 (AT-027) nota autorizada · G04 (AT-028) trilha só de acréscimo · G08 (AT-029) documento imutável.

-- Nota autorizada: nenhum dado muda; a situação só vai para cancelada/substituida por fn_registrar_evento.
create or replace function app.trg_nota_imutavel() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.situacao <> 'rascunho' then
      raise exception 'nota % não pode ser excluída (situação %)', old.id, old.situacao using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.situacao in ('autorizada', 'cancelada', 'substituida') then
    if old.situacao = 'autorizada'
       and current_setting('app.evento_registrado', true) = 'on'
       and new.situacao in ('cancelada', 'substituida')
       and (to_jsonb(new) - 'situacao' - 'atualizado_em') = (to_jsonb(old) - 'situacao' - 'atualizado_em') then
      return new;
    end if;
    raise exception 'nota autorizada não pode ser alterada; use cancelamento ou substituição' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger nota_imutavel before update or delete on public.nota
  for each row execute function app.trg_nota_imutavel();

-- Pela tela (papel authenticated) só se edita rascunho/rejeitada e só se enfileira; o resto é do servidor.
create or replace function app.trg_nota_transicao_cliente() returns trigger language plpgsql as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.situacao <> 'rascunho' or new.chave_acesso is not null or new.documento_id is not null
       or new.numero_dps is not null or new.id_dps is not null or new.danfse_documento_id is not null
       or new.tentativas <> 0 then
      raise exception 'nova nota pela tela só como rascunho' using errcode = '42501';
    end if;
    new.criado_por := auth.uid();
    return new;
  end if;
  if not (old.situacao in ('rascunho', 'rejeitada') and new.situacao in ('rascunho', 'na_fila')) then
    raise exception 'mudança de situação % → % não permitida pela tela', old.situacao, new.situacao using errcode = '42501';
  end if;
  if new.chave_acesso is distinct from old.chave_acesso or new.documento_id is distinct from old.documento_id
     or new.numero_dps is distinct from old.numero_dps or new.id_dps is distinct from old.id_dps
     or new.serie_dps is distinct from old.serie_dps or new.tentativas is distinct from old.tentativas
     or new.danfse_documento_id is distinct from old.danfse_documento_id
     or new.nota_substituida_id is distinct from old.nota_substituida_id
     or new.empresa_id is distinct from old.empresa_id then
    raise exception 'campo controlado pelo sistema' using errcode = '42501';
  end if;
  if old.situacao = 'rejeitada' then
    new.codigo_rejeicao := null; new.motivo_rejeicao := null; new.tentativas := 0; new.proxima_tentativa_em := null;
  end if;
  return new;
end $$;
create trigger nota_transicao_cliente before insert or update on public.nota
  for each row execute function app.trg_nota_transicao_cliente();

-- Documento: gravado uma vez, nunca alterado nem excluído.
create or replace function app.trg_somente_insercao() returns trigger language plpgsql as $$
begin
  raise exception '% é só de acréscimo: % recusado', tg_table_name, lower(tg_op) using errcode = 'P0001';
end $$;

create trigger documento_imutavel before update or delete on public.documento
  for each row execute function app.trg_somente_insercao();
create trigger documento_sem_truncate before truncate on public.documento
  for each statement execute function app.trg_somente_insercao();

create trigger auditoria_imutavel before update or delete on public.auditoria
  for each row execute function app.trg_somente_insercao();
create trigger auditoria_sem_truncate before truncate on public.auditoria
  for each statement execute function app.trg_somente_insercao();

create trigger evento_imutavel before update or delete on public.evento_nota
  for each row execute function app.trg_somente_insercao();

create trigger log_seguranca_imutavel before update or delete on public.log_seguranca
  for each row execute function app.trg_somente_insercao();
create trigger log_seguranca_sem_truncate before truncate on public.log_seguranca
  for each statement execute function app.trg_somente_insercao();

-- Ninguém além das funções security definer escreve na trilha, no log ou nos documentos.
revoke insert, update, delete, truncate on public.auditoria, public.log_seguranca, public.documento,
  public.evento_nota, public.ancora_auditoria from anon, authenticated;

-- Cancelamento/substituição já aceitos pela Sefin: grava o evento e muda a situação da nota.
create or replace function public.fn_registrar_evento(
  p_empresa_id uuid, p_nota_id uuid, p_tipo text, p_codigo_motivo text, p_motivo text,
  p_quem uuid, p_protocolo text, p_documento_id uuid, p_nota_substituta_id uuid default null, p_ip inet default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_evento uuid; v_nota public.nota;
begin
  if not app.usuario_pode_administrar(p_quem, p_empresa_id) then
    raise exception 'usuário sem permissão para cancelar ou substituir' using errcode = '42501';
  end if;
  if p_motivo is null or length(trim(p_motivo)) < 15 then
    raise exception 'motivo obrigatório (mínimo 15 caracteres)' using errcode = '23514';
  end if;
  select * into v_nota from public.nota where empresa_id = p_empresa_id and id = p_nota_id for update;
  if v_nota.situacao is distinct from 'autorizada' then
    raise exception 'só nota autorizada pode ser cancelada ou substituída' using errcode = 'P0001';
  end if;
  perform set_config('app.quem', p_quem::text, true);
  perform set_config('app.motivo', p_motivo, true);
  perform set_config('app.ip', coalesce(p_ip::text, ''), true);
  insert into public.evento_nota (empresa_id, nota_id, tipo, codigo_motivo, motivo, nota_substituta_id, protocolo, documento_id, registrado_por)
  values (p_empresa_id, p_nota_id, p_tipo, p_codigo_motivo, p_motivo, p_nota_substituta_id, p_protocolo, p_documento_id, p_quem)
  returning id into v_evento;
  perform set_config('app.evento_registrado', 'on', true);
  update public.nota set situacao = case when p_tipo = 'cancelamento' then 'cancelada' else 'substituida' end::public.situacao_nota
   where empresa_id = p_empresa_id and id = p_nota_id;
  perform set_config('app.evento_registrado', 'off', true);
  if not exists (select 1 from public.perfil_usuario where usuario_id = p_quem and papel in ('escritorio_admin', 'escritorio_operador')) then
    perform public.fn_avisar(p_empresa_id, p_tipo, p_nota_id,
      format('%s da nota %s pelo cliente: %s', initcap(p_tipo), coalesce(v_nota.numero_nfse, v_nota.chave_acesso), p_motivo), p_quem);
  end if;
  return v_evento;
end $$;
revoke all on function public.fn_registrar_evento(uuid, uuid, text, text, text, uuid, text, uuid, uuid, inet) from public, anon, authenticated;
grant execute on function public.fn_registrar_evento(uuid, uuid, text, text, text, uuid, text, uuid, uuid, inet) to service_role;
