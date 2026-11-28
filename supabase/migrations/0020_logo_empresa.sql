-- 0020 — logo da empresa no DANFSe (pedido do José, 28/11/2026). A imagem fica no bucket privado `documentos`
-- em `{empresa_id}/logo/logo-<sha256>.<png|jpg>` (gravada só pelo servidor); a coluna guarda o caminho.
-- Sem logo (null): o PDF sai só com a logomarca oficial da NFS-e.

alter table public.empresa add column if not exists logo_path text
  check (logo_path is null or logo_path ~ '^[0-9a-f-]{36}/logo/logo-[0-9a-f]{12}\.(png|jpg)$');

comment on column public.empresa.logo_path is 'Logo da empresa para o DANFSe (bucket documentos); null = só a logomarca da NFS-e.';
