-- 0018 — ISS fixo (sociedade de profissionais) e retenções federais (pedido do José, 27/11/2026).
-- Empresa: regime do ISS. 'sociedade_profissionais' = ISS fixo (ex.: escritório contábil no Simples,
-- LC 123 art. 18 §22-A): a DPS vai com regEspTrib 6, sem alíquota e sem ISS retido.
-- Retenções: percentuais no serviço (padrão) e na nota; a nota guarda também os valores em R$
-- calculados pelo sistema (base = valor do serviço, half-up na 2ª casa, AT-030) e o valor líquido.

alter table public.empresa
  add column if not exists regime_iss text not null default 'normal'
    check (regime_iss in ('normal', 'sociedade_profissionais'));
comment on column public.empresa.regime_iss is 'normal = ISS pela alíquota (DAS ou retido); sociedade_profissionais = ISS fixo (regEspTrib 6).';

-- só o escritório muda o regime do ISS (mesma regra de CNPJ, regime e numeração)
create or replace function app.trg_empresa_campos_do_escritorio() returns trigger
language plpgsql as $$
begin
  if auth.role() = 'authenticated' and not app.e_escritorio() then
    if new.cnpj is distinct from old.cnpj or new.regime is distinct from old.regime
       or new.serie_dps is distinct from old.serie_dps or new.proximo_ndps is distinct from old.proximo_ndps
       or new.pausada is distinct from old.pausada or new.ativa is distinct from old.ativa
       or new.cod_municipio is distinct from old.cod_municipio
       or new.regime_iss is distinct from old.regime_iss then
      raise exception 'só o escritório altera CNPJ, regime, regime do ISS, município, numeração ou pausa' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

alter table public.servico
  add column if not exists pct_ret_inss numeric(5, 2) check (pct_ret_inss is null or (pct_ret_inss > 0 and pct_ret_inss < 100)),
  add column if not exists pct_ret_irrf numeric(5, 2) check (pct_ret_irrf is null or (pct_ret_irrf > 0 and pct_ret_irrf < 100)),
  add column if not exists pct_ret_csll numeric(5, 2) check (pct_ret_csll is null or (pct_ret_csll > 0 and pct_ret_csll < 100)),
  add column if not exists pct_ret_pis numeric(5, 2) check (pct_ret_pis is null or (pct_ret_pis > 0 and pct_ret_pis < 100)),
  add column if not exists pct_ret_cofins numeric(5, 2) check (pct_ret_cofins is null or (pct_ret_cofins > 0 and pct_ret_cofins < 100));

alter table public.nota
  add column if not exists pct_ret_inss numeric(5, 2) check (pct_ret_inss is null or (pct_ret_inss > 0 and pct_ret_inss < 100)),
  add column if not exists pct_ret_irrf numeric(5, 2) check (pct_ret_irrf is null or (pct_ret_irrf > 0 and pct_ret_irrf < 100)),
  add column if not exists pct_ret_csll numeric(5, 2) check (pct_ret_csll is null or (pct_ret_csll > 0 and pct_ret_csll < 100)),
  add column if not exists pct_ret_pis numeric(5, 2) check (pct_ret_pis is null or (pct_ret_pis > 0 and pct_ret_pis < 100)),
  add column if not exists pct_ret_cofins numeric(5, 2) check (pct_ret_cofins is null or (pct_ret_cofins > 0 and pct_ret_cofins < 100)),
  add column if not exists valor_ret_inss numeric(18, 2) not null default 0 check (valor_ret_inss >= 0),
  add column if not exists valor_ret_irrf numeric(18, 2) not null default 0 check (valor_ret_irrf >= 0),
  add column if not exists valor_ret_csll numeric(18, 2) not null default 0 check (valor_ret_csll >= 0),
  add column if not exists valor_ret_pis numeric(18, 2) not null default 0 check (valor_ret_pis >= 0),
  add column if not exists valor_ret_cofins numeric(18, 2) not null default 0 check (valor_ret_cofins >= 0);

comment on column public.nota.valor_liquido is 'Valor do serviço menos ISS retido e retenções federais (cálculo do sistema; a Sefin devolve o oficial em vLiq).';
