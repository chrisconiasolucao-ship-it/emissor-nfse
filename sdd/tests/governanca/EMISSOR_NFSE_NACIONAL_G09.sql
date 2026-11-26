-- G09 — passa SÓ se nenhuma coluna de VALOR (pelo nome) for de ponto flutuante, em qualquer schema do usuário.
begin;
do $$
declare v_col text;
begin
  -- pg_catalog, não information_schema: a view esconde as tabelas a que este papel não tem acesso
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where c.relkind in ('r', 'p') and n.nspname not in ('pg_catalog', 'information_schema')
                    and n.nspname not like 'pg\_%') then
    raise exception 'GOVERNANCA G09 REPROVADA: nenhuma tabela do usuario, nada a provar';
  end if;
  -- colunas de VALOR: acrescente ao padrao os nomes que o seu schema usa para dinheiro
  select string_agg(n.nspname || '.' || c.relname || '.' || a.attname, ', ') into v_col
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid and c.relkind in ('r', 'p')
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
     and a.attnum > 0 and not a.attisdropped
     -- tipo-base, em qualquer profundidade: domínio sobre domínio sobre double precision também é ponto flutuante
     and exists (with recursive cadeia(t) as (
                   select a.atttypid
                   union all
                   select ty.typbasetype from pg_type ty join cadeia on ty.oid = cadeia.t where ty.typbasetype <> 0)
                 select 1 from cadeia where t in ('real'::regtype, 'double precision'::regtype))
     and a.attname ~* '(valor|preco|saldo|total|montante|debito|credito|juros|multa|desconto|aliquota|imposto|tributo|tarifa|salario|iss|deducao|retencao|base_calculo|liquido)';
  if v_col is not null then
    raise exception 'GOVERNANCA G09 REPROVADA: ponto flutuante em %', v_col;
  end if;
  raise notice 'G09 ok: nenhuma coluna de valor em real/double precision';
end $$;
rollback;
