-- 0015 — resumo das NFS-e guardadas (pedido do José, 27/11/2026): a tela Importar mostra as notas do ADN
-- separadas em prestadas (a empresa emitiu) e tomadas (a empresa contratou), com a outra parte, a competência
-- e o valor, sem abrir cada XML. Preenchido na gravação; o documento continua imutável (0005).
alter table public.documento
  add column if not exists papel text check (papel is null or papel in ('prestada', 'tomada')),
  add column if not exists outra_parte text,
  add column if not exists outra_parte_documento text,
  add column if not exists numero_nfse text,
  add column if not exists competencia date,
  add column if not exists valor numeric(15, 2) check (valor is null or valor >= 0);

create index if not exists documento_origem_recentes on public.documento (empresa_id, criado_em desc) where tipo = 'xml_origem';

comment on column public.documento.papel is 'NFS-e de origem: prestada (a empresa é a prestadora) ou tomada (a empresa é a tomadora).';
