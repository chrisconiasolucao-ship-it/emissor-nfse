-- 0007 — Storage: buckets privados por empresa (AT-032 / G13, AT-011, AT-029).
-- Caminho sempre `{empresa_id}/...`. Gravação só pelo servidor (service role), sempre sem sobrescrever
-- (upsert: false) e com nome = sha256. Downloads passam por /api/documentos/[id] (log de segurança).

insert into storage.buckets (id, name, public, file_size_limit)
values ('certificados', 'certificados', false, 1048576),
       ('documentos', 'documentos', false, 10485760)
on conflict (id) do nothing;

-- certificados: nenhuma política para anon/authenticated ⇒ ninguém lê nem baixa pela API pública.

-- documentos: leitura só da própria empresa (o 1º segmento do caminho é o empresa_id).
create policy documentos_ler on storage.objects for select to authenticated
  using (bucket_id = 'documentos'
         and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
         and app.pode_ver(((storage.foldername(name))[1])::uuid));

-- Nenhuma política de insert/update/delete para authenticated em nenhum dos dois buckets.
