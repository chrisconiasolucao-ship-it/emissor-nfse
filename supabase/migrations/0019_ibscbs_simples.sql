-- 0019 — IBS e CBS do Simples Nacional na NFS-e (NT 009, Anexo VI v1.04.01; pedido do José, 27/11/2026).
-- Para o Simples, o grupo IBSCBS da DPS passa a ser obrigatório em 2027. O Release 4 (previsto para 24/12/2026)
-- traz regApIBSCBSSN (empresa) e cAtvSN (serviço). Até a Receita liberar, o envio fica desligado pela variável
-- NFSE_IBSCBS_SIMPLES; estas tabelas e campos só preparam o cadastro.
--
-- Tabelas de referência: base oficial da Calculadora de Tributos da Receita Federal
-- (github.com/ReceitaFederal/calculadora-rtc-regime-regular, migração V0074; cClassTrib = IT 2025.002 v1.71 de 30/10/2026),
-- só o que vale para NFS-e. A carga é feita pelo servidor (/api/worker/catalogo), como na 0011.

-- CST do IBS/CBS (3 dígitos). exige_gibscbs = indicador da tabela oficial.
create table if not exists public.cst_ibscbs (
  codigo char(3) primary key check (codigo ~ '^\d{3}$'),
  descricao text not null,
  exige_gibscbs boolean not null default false
);

-- Classificação tributária (cClassTrib). tp_rbsn = como entra na receita bruta do Simples (0 = não é receita bruta;
-- 1 = interna; 2 = interna sem IBS/CBS; 3 = exportação direta; 4 = indireta; 5 = interna e exportação; 9 = incompatível com o SN).
create table if not exists public.cclasstrib (
  codigo char(6) primary key check (codigo ~ '^\d{6}$'),
  cst char(3) not null references public.cst_ibscbs (codigo),
  nome text not null,
  tp_rbsn smallint,
  inicio_vigencia date not null
);

-- Indicador da operação (cIndOp), versão que vale a partir de 07/12/2026.
create table if not exists public.indop_ibscbs (
  codigo char(6) primary key check (codigo ~ '^\d{6}$'),
  local_incidencia text not null,
  tipo_operacao text not null,
  inicio_vigencia date not null
);

-- Correlação oficial subitem/cTribNac × NBS × indicador × cClassTrib (Anexo VIII), base da sugestão no serviço.
create table if not exists public.correlacao_ibscbs (
  item varchar(6) not null check (item ~ '^\d{4}(\d{2})?$'),
  nbs char(9) not null check (nbs ~ '^\d{9}$'),
  ind_op char(6) not null check (ind_op ~ '^\d{6}$'),
  cclasstrib char(6) not null check (cclasstrib ~ '^\d{6}$'),
  inicio_vigencia date not null,
  primary key (item, nbs, ind_op, cclasstrib)
);
create index if not exists correlacao_ibscbs_nbs on public.correlacao_ibscbs (nbs);

-- Código da atividade do Simples Nacional (cAtvSN) aceito na NFS-e.
create table if not exists public.atividade_simples (
  codigo char(2) primary key check (codigo ~ '^\d{2}$'),
  anexo text not null,
  descricao text not null
);

alter table public.cst_ibscbs enable row level security;
alter table public.cclasstrib enable row level security;
alter table public.indop_ibscbs enable row level security;
alter table public.correlacao_ibscbs enable row level security;
alter table public.atividade_simples enable row level security;
revoke all on public.cst_ibscbs, public.cclasstrib, public.indop_ibscbs, public.correlacao_ibscbs, public.atividade_simples from anon, authenticated;
grant select on public.cst_ibscbs, public.cclasstrib, public.indop_ibscbs, public.correlacao_ibscbs, public.atividade_simples to authenticated;
drop policy if exists cst_ibscbs_ler on public.cst_ibscbs;
drop policy if exists cclasstrib_ler on public.cclasstrib;
drop policy if exists indop_ibscbs_ler on public.indop_ibscbs;
drop policy if exists correlacao_ibscbs_ler on public.correlacao_ibscbs;
drop policy if exists atividade_simples_ler on public.atividade_simples;
create policy cst_ibscbs_ler on public.cst_ibscbs for select to authenticated using (true);
create policy cclasstrib_ler on public.cclasstrib for select to authenticated using (true);
create policy indop_ibscbs_ler on public.indop_ibscbs for select to authenticated using (true);
create policy correlacao_ibscbs_ler on public.correlacao_ibscbs for select to authenticated using (true);
create policy atividade_simples_ler on public.atividade_simples for select to authenticated using (true);

-- Empresa: regime do IBS/CBS no Simples (regApIBSCBSSN) e atividade do Simples padrão (cAtvSN).
alter table public.empresa
  add column if not exists regime_ibscbs_sn smallint not null default 1 check (regime_ibscbs_sn in (1, 2, 3)),
  add column if not exists cativ_sn char(2) check (cativ_sn is null or cativ_sn ~ '^\d{2}$');
comment on column public.empresa.regime_ibscbs_sn is 'regApIBSCBSSN (ME/EPP): 1 = IBS e CBS pelo Simples; 2 = CBS pelo Simples e IBS pelo regime regular (sublimite); 3 = IBS e CBS pelo regime regular.';
comment on column public.empresa.cativ_sn is 'cAtvSN padrão da empresa (07 = Anexo III, 08 = contábil com ISS fixo, 09 = Fator R...). O serviço pode ter o seu.';

-- Serviço: classificação do IBS/CBS. Vazio = o sistema usa a correlação oficial quando ela só tem uma opção.
alter table public.servico
  add column if not exists cclasstrib char(6) check (cclasstrib is null or cclasstrib ~ '^\d{6}$'),
  add column if not exists cind_op char(6) check (cind_op is null or cind_op ~ '^\d{6}$'),
  add column if not exists cativ_sn char(2) check (cativ_sn is null or cativ_sn ~ '^\d{2}$');

-- só o escritório muda o regime do IBS/CBS (mesma regra de CNPJ, regime e regime do ISS)
create or replace function app.trg_empresa_campos_do_escritorio() returns trigger
language plpgsql as $$
begin
  if auth.role() = 'authenticated' and not app.e_escritorio() then
    if new.cnpj is distinct from old.cnpj or new.regime is distinct from old.regime
       or new.serie_dps is distinct from old.serie_dps or new.proximo_ndps is distinct from old.proximo_ndps
       or new.pausada is distinct from old.pausada or new.ativa is distinct from old.ativa
       or new.cod_municipio is distinct from old.cod_municipio
       or new.regime_iss is distinct from old.regime_iss
       or new.regime_ibscbs_sn is distinct from old.regime_ibscbs_sn or new.cativ_sn is distinct from old.cativ_sn then
      raise exception 'só o escritório altera CNPJ, regime, regime do ISS, regime do IBS/CBS, município, numeração ou pausa' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- confere: deve mostrar 5 tabelas e 5 colunas novas
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename in ('cst_ibscbs', 'cclasstrib', 'indop_ibscbs', 'correlacao_ibscbs', 'atividade_simples')) as tabelas,
  (select count(*) from pg_attribute where not attisdropped and (
     (attrelid = 'public.empresa'::regclass and attname in ('regime_ibscbs_sn', 'cativ_sn')) or
     (attrelid = 'public.servico'::regclass and attname in ('cclasstrib', 'cind_op', 'cativ_sn')))) as colunas;
