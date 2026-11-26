-- G08 — passa SÓ se o banco RECUSAR trocar o hash de um documento já ligado a nota.
begin;
-- Preparação em bloco próprio: o papel LÊ as tabelas e há o que provar. Qualquer erro aqui reprova —
-- assim um 42501 no bloco da tentativa só pode vir da ESCRITA proibida, nunca da leitura.
do $$
begin
  if not has_table_privilege('nota', 'SELECT') then
    raise exception 'GOVERNANCA G08 REPROVADA: a preparacao falhou, este papel nao le nota — rode com um papel que leia a tabela';
  end if;
  if not has_table_privilege('documento', 'SELECT') then
    raise exception 'GOVERNANCA G08 REPROVADA: a preparacao falhou, este papel nao le documento — rode com um papel que leia a tabela';
  end if;
  if not exists (select 1 from nota where documento_id is not null) then
    raise exception 'GOVERNANCA G08 REPROVADA: nenhuma nota ligada a documento, nada a provar';
  end if;
exception when others then
  if sqlerrm like 'GOVERNANCA G%' then raise; end if;
  raise exception 'GOVERNANCA G08 REPROVADA: a preparacao falhou (%): %', sqlstate, sqlerrm;
end $$;
do $$
begin
  update documento set sha256 = encode(sha256(convert_to('troca', 'UTF8')), 'hex') where id = (select documento_id from nota where documento_id is not null limit 1);
  raise exception 'GOVERNANCA G08 REPROVADA: o hash do documento-fonte foi alterado';
exception when others then
  if sqlerrm like 'GOVERNANCA G%' then raise; end if;
  if sqlstate not in ('P0001', '42501') then
    raise exception 'GOVERNANCA G08 REPROVADA: a tentativa falhou por outro motivo, nao pela regra (%): %', sqlstate, sqlerrm;
  end if;
  raise notice 'G08 ok: %', sqlerrm;
end $$;
rollback;
