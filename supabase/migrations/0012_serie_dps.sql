-- Série da DPS: o esquema da Sefin (TSSerieDPS, v1.01) aceita [0-9]{1,4}|[0-8][0-9]{4}, e a faixa de aplicativo
-- próprio do contribuinte é 00001 a 49999. A série 90001 do padrão antigo era rejeitada (E1235). Novo padrão: 900.
alter table public.empresa alter column serie_dps set default '900';
update public.empresa set serie_dps = '900'
 where not (serie_dps ~ '^\d{1,5}$' and serie_dps::int between 1 and 49999);
alter table public.empresa drop constraint if exists empresa_serie_dps_check;
alter table public.empresa add constraint empresa_serie_dps_check
  check (serie_dps ~ '^\d{1,5}$' and serie_dps::int between 1 and 49999);
