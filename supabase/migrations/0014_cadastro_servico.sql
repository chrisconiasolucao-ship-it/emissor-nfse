-- 0014 — cadastro de serviços por empresa (pedido do José, 26/11/2026): o serviço salvo preenche a nota inteira
-- (código, NBS, descrição, local da prestação, valor e retenção). Serviços e tomadores também nascem das notas
-- importadas (XML enviado ou ADN) em que a empresa é a prestadora; a origem fica registrada.
alter table public.servico
  add column if not exists nome text,
  add column if not exists cod_municipio_prestacao char(7) check (cod_municipio_prestacao is null or cod_municipio_prestacao ~ '^\d{7}$'),
  add column if not exists valor_padrao numeric(15, 2) check (valor_padrao is null or valor_padrao > 0),
  add column if not exists iss_retido boolean not null default false,
  add column if not exists origem text not null default 'manual' check (origem in ('manual', 'nota', 'xml', 'adn')),
  add column if not exists atualizado_em timestamptz not null default now();

drop trigger if exists servico_atualizado on public.servico;
create trigger servico_atualizado before update on public.servico
  for each row execute function app.tocar_atualizado_em();

-- o mesmo serviço (código + descrição) não entra duas vezes na mesma empresa, nem por importação repetida
create unique index if not exists servico_unico on public.servico
  (empresa_id, codigo_tributacao_nacional, md5(lower(btrim(descricao))));

alter table public.tomador
  add column if not exists origem text not null default 'nota' check (origem in ('manual', 'nota', 'planilha', 'xml', 'adn'));

comment on column public.servico.nome is 'Nome curto para achar o serviço na lista (ex.: Honorários mensais).';
comment on column public.servico.valor_padrao is 'Valor sugerido na nota; pode ser trocado na hora de emitir.';
