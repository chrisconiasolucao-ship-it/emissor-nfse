-- G04 — passa SÓ se o papel da aplicação NÃO conseguir inserir, alterar nem apagar a trilha.
begin;
do $$
begin
  if has_table_privilege('authenticated', 'auditoria', 'INSERT') then
    if exists (select 1 from pg_attribute a
                where a.attrelid = 'auditoria'::regclass and a.attnum > 0 and not a.attisdropped and a.attidentity = ''
                  and pg_get_serial_sequence('auditoria', a.attname) is not null
                  and not has_sequence_privilege('authenticated', pg_get_serial_sequence('auditoria', a.attname), 'USAGE')) then
      raise exception 'GOVERNANCA G04 REPROVADA: a preparacao falhou, o papel nao usa a sequencia do id de auditoria — a tentativa falharia pela sequencia, nao pela regra';
    end if;
  end if;
  if not exists (select 1 from auditoria) then
    raise exception 'GOVERNANCA G04 REPROVADA: trilha vazia, nada a provar — grave 1 evento de teste';
  end if;
exception when others then
  if sqlerrm like 'GOVERNANCA G%' then raise; end if;
  raise exception 'GOVERNANCA G04 REPROVADA: a preparacao falhou, a trilha nao confere com o schema (%): %', sqlstate, sqlerrm;
end $$;
set local role authenticated;
do $$
begin
  insert into auditoria (acao, motivo) values ('teste G04', 'escrita direta');
  raise exception 'GOVERNANCA G04 REPROVADA: o cliente escreveu direto na trilha de auditoria';
exception when others then
  if sqlerrm like 'GOVERNANCA G%' then raise; end if;
  if sqlstate not in ('42501', 'P0001') then
    raise exception 'GOVERNANCA G04 REPROVADA: a tentativa falhou por outro motivo, nao pela regra (%): %', sqlstate, sqlerrm;
  end if;
  raise notice 'G04 ok (insert recusado): %', sqlerrm;
end $$;
do $$
begin
  update auditoria set motivo = 'alterado';
  raise exception 'GOVERNANCA G04 REPROVADA: o cliente alterou a trilha de auditoria';
exception when others then
  if sqlerrm like 'GOVERNANCA G%' then raise; end if;
  if sqlstate not in ('42501', 'P0001') then
    raise exception 'GOVERNANCA G04 REPROVADA: a tentativa falhou por outro motivo, nao pela regra (%): %', sqlstate, sqlerrm;
  end if;
  raise notice 'G04 ok (update recusado): %', sqlerrm;
end $$;
do $$
begin
  delete from auditoria;
  raise exception 'GOVERNANCA G04 REPROVADA: o cliente apagou a trilha de auditoria';
exception when others then
  if sqlerrm like 'GOVERNANCA G%' then raise; end if;
  if sqlstate not in ('42501', 'P0001') then
    raise exception 'GOVERNANCA G04 REPROVADA: a tentativa falhou por outro motivo, nao pela regra (%): %', sqlstate, sqlerrm;
  end if;
  raise notice 'G04 ok (delete recusado): %', sqlerrm;
end $$;
rollback;
