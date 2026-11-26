-- 0011 — tabelas de referência da NFS-e Nacional (fornecidas pelo escritório em 26/11/2026):
-- código de tributação nacional (cTribNac), NBS, indicador de operação (IBS/CBS) e correlação item × NBS.
-- Só leitura pela tela; a carga é feita pelo servidor (/api/worker/catalogo) a partir de src/lib/catalogo/*.json.

create table public.cod_tributacao_nacional (
  codigo char(6) primary key check (codigo ~ '^\d{6}$'),
  descricao text not null
);

create table public.nbs (
  codigo char(9) primary key check (codigo ~ '^\d{9}$'),
  descricao text not null
);

create table public.ind_operacao (
  codigo char(6) primary key check (codigo ~ '^\d{6}$'),
  descricao text not null
);

-- item: subitem da LC 116 (4 dígitos, casa com os 4 primeiros do cTribNac) ou o cTribNac inteiro (6 dígitos, itens 99)
create table public.correlacao_item_nbs (
  item varchar(6) not null check (item ~ '^\d{4}(\d{2})?$'),
  nbs char(9) not null references public.nbs (codigo),
  ind_op char(6) not null check (ind_op ~ '^\d{6}$'),
  cclasstrib char(6) not null check (cclasstrib ~ '^\d{6}$'),
  primary key (item, nbs)
);
create index correlacao_nbs on public.correlacao_item_nbs (nbs);

alter table public.cod_tributacao_nacional enable row level security;
alter table public.nbs enable row level security;
alter table public.ind_operacao enable row level security;
alter table public.correlacao_item_nbs enable row level security;
revoke all on public.cod_tributacao_nacional, public.nbs, public.ind_operacao, public.correlacao_item_nbs from anon, authenticated;
grant select on public.cod_tributacao_nacional, public.nbs, public.ind_operacao, public.correlacao_item_nbs to authenticated;
create policy cod_trib_ler on public.cod_tributacao_nacional for select to authenticated using (true);
create policy nbs_ler on public.nbs for select to authenticated using (true);
create policy ind_op_ler on public.ind_operacao for select to authenticated using (true);
create policy correlacao_ler on public.correlacao_item_nbs for select to authenticated using (true);
