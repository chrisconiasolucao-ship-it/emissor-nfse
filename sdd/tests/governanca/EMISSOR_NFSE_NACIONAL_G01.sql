-- G01 — passa SÓ se o banco RECUSAR alterar e excluir nota autorizada.
begin;
-- Preparação em bloco próprio: o papel LÊ as tabelas e há o que provar. Qualquer erro aqui reprova —
-- assim um 42501 no bloco da tentativa só pode vir da ESCRITA proibida, nunca da leitura.
do $$
begin
  if not has_table_privilege('nota', 'SELECT') then
    raise exception 'GOVERNANCA G01 REPROVADA: a preparacao falhou, este papel nao le nota — rode com um papel que leia a tabela';
  end if;
  if not exists (select 1 from nota where situacao = 'autorizada') then
    raise exception 'GOVERNANCA G01 REPROVADA: nenhuma nota autorizada, nada a provar — grave 1 nota autorizada de teste';
  end if;
exception when others then
  if sqlerrm like 'GOVERNANCA G%' then raise; end if;
  raise exception 'GOVERNANCA G01 REPROVADA: a preparacao falhou (%): %', sqlstate, sqlerrm;
end $$;
do $$
begin
  update nota set descricao = descricao where id = (select id from nota where situacao = 'autorizada' limit 1);
  raise exception 'GOVERNANCA G01 REPROVADA: UPDATE em nota autorizada foi aceito pelo banco';
exception when others then
  if sqlerrm like 'GOVERNANCA G%' then raise; end if;
  if sqlstate not in ('P0001', '42501') then
    raise exception 'GOVERNANCA G01 REPROVADA: a tentativa falhou por outro motivo, nao pela regra (%): %', sqlstate, sqlerrm;
  end if;
  raise notice 'G01 ok (update recusado): %', sqlerrm;
end $$;
do $$
begin
  delete from nota where id = (select id from nota where situacao = 'autorizada' limit 1);
  raise exception 'GOVERNANCA G01 REPROVADA: DELETE em nota autorizada foi aceito pelo banco';
exception when others then
  if sqlerrm like 'GOVERNANCA G%' then raise; end if;
  if sqlstate not in ('P0001', '42501') then
    raise exception 'GOVERNANCA G01 REPROVADA: a tentativa falhou por outro motivo, nao pela regra (%): %', sqlstate, sqlerrm;
  end if;
  raise notice 'G01 ok (delete recusado): %', sqlerrm;
end $$;
rollback;
