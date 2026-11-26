-- G10 — passa SÓ se o banco RECUSAR a 2ª inserção da mesma chave natural.
begin;
-- Preparação em bloco próprio: o papel LÊ as tabelas e há o que provar. Qualquer erro aqui reprova —
-- assim um 42501 no bloco da tentativa só pode vir da ESCRITA proibida, nunca da leitura.
do $$
begin
  if not has_table_privilege('nota', 'SELECT') then
    raise exception 'GOVERNANCA G10 REPROVADA: a preparacao falhou, este papel nao le nota — rode com um papel que leia a tabela';
  end if;
  if not exists (select 1 from nota where chave_acesso is not null) then
    raise exception 'GOVERNANCA G10 REPROVADA: nenhuma nota com chave de acesso, nada a provar';
  end if;
exception when others then
  if sqlerrm like 'GOVERNANCA G%' then raise; end if;
  raise exception 'GOVERNANCA G10 REPROVADA: a preparacao falhou (%): %', sqlstate, sqlerrm;
end $$;
-- Controle: uma nota com chave NOVA tem de gravar — prova que id, sequência e colunas obrigatórias não
-- recusam por conta própria a inserção da tentativa.
do $$
begin
  begin
    -- adaptado ao schema (Build): empresa_id é obrigatório; o controle usa a empresa de uma nota existente
    insert into nota (empresa_id, descricao, chave_acesso)
    select empresa_id, 'controle G10', 'controle-g10-' || txid_current() from nota where chave_acesso is not null limit 1;
    raise exception 'GOVERNANCA_CONTROLE_OK';
  exception when others then
    if sqlerrm <> 'GOVERNANCA_CONTROLE_OK' then
      raise exception 'GOVERNANCA G10 REPROVADA: a preparacao falhou, uma nota com chave nova nao grava (%): %', sqlstate, sqlerrm;
    end if;
  end;
exception when others then
  if sqlerrm like 'GOVERNANCA G%' then raise; end if;
  raise exception 'GOVERNANCA G10 REPROVADA: a preparacao falhou (%): %', sqlstate, sqlerrm;
end $$;
do $$
declare v_cons text;
begin
  insert into nota (empresa_id, descricao, chave_acesso)
  select empresa_id, 'teste G10', chave_acesso from nota where chave_acesso is not null limit 1;
  -- UNIQUE DEFERRABLE só confere no commit: força a conferência AGORA, dentro deste bloco
  set constraints all immediate;
  raise exception 'GOVERNANCA G10 REPROVADA: chave de acesso repetida foi aceita';
exception when others then
  if sqlerrm like 'GOVERNANCA G%' then raise; end if;
  if sqlstate not in ('23505') then
    raise exception 'GOVERNANCA G10 REPROVADA: a tentativa falhou por outro motivo, nao pela regra (%): %', sqlstate, sqlerrm;
  end if;
  get stacked diagnostics v_cons = constraint_name;
  -- o índice violado tem de CONTER a chave natural: conflito na PK ou em outra UNIQUE não prova nada
  -- só as colunas de CHAVE do índice (as do INCLUDE não participam da unicidade); por definição de cada
  -- coluna, vale também UNIQUE por expressão, como lower(chave_acesso); e o índice é DESTA tabela ou de uma
  -- partição dela — um homônimo em outro schema não prova nada
  if not exists (select 1 from pg_index i join pg_class ic on ic.oid = i.indexrelid
                   cross join generate_series(1, i.indnkeyatts) k
                  where ic.relname = v_cons
                    and i.indrelid in (select 'nota'::regclass
                                       union select relid from pg_partition_tree('nota'::regclass))
                    and pg_get_indexdef(i.indexrelid, k, true) ~* '\mchave_acesso\M') then
    raise exception 'GOVERNANCA G10 REPROVADA: o conflito foi em % , que nao contem a chave natural', v_cons;
  end if;
  raise notice 'G10 ok: %', sqlerrm;
end $$;
rollback;
