-- Dados do branch `teste` (nunca da produção). Dão aos scripts de governança e aos testes o que provar.
-- Usuários são criados pelos testes de integração (Auth admin API), não aqui.

insert into public.empresa (id, cnpj, razao_social, regime, cod_municipio, serie_dps, inscricao_municipal)
values
  ('00000000-0000-4000-8000-00000000000a', '11222333000181', 'EMPRESA A TESTE LTDA', 'ME', '4301602', '90001', '123'),
  ('00000000-0000-4000-8000-00000000000b', '44555666000102', 'EMPRESA B TESTE LTDA', 'EPP', '4314902', '90001', '456')
on conflict (id) do nothing;

insert into public.municipio_situacao (cod_ibge, nome, uf, conveniado, ativo_operacional, emissor_nacional)
values
  ('4301602', 'Bagé', 'RS', true, true, false),
  ('4314902', 'Porto Alegre', 'RS', true, true, false),
  ('3521408', 'Iperó', 'SP', true, true, true)
on conflict (cod_ibge) do nothing;

insert into public.tomador (empresa_id, id, tipo_documento, documento, nome, cod_municipio)
values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1', 'CPF', '52998224725', 'TOMADOR PF DA EMPRESA A', '4301602'),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000b1', 'CNPJ', '11444777000161', 'TOMADOR PJ DA EMPRESA B', '3521408')
on conflict do nothing;

insert into public.servico (empresa_id, id, codigo_tributacao_nacional, codigo_nbs, descricao, aliquota_iss)
values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a2', '010601', '113032000', 'Assessoria e consultoria em informática', 2.0100),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000b2', '170201', '113032000', 'Assessoria contábil', 3.0000)
on conflict do nothing;

-- Uma nota autorizada da empresa A com XML guardado (G01, G08, G10).
insert into public.documento (empresa_id, id, tipo, storage_path, sha256, tamanho, content_type, nome_original)
values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a3', 'xml_autorizado',
        '00000000-0000-4000-8000-00000000000a/xml_autorizado/seed.xml',
        encode(extensions.digest('xml de teste do seed', 'sha256'), 'hex'), 21, 'application/xml', 'seed.xml')
on conflict do nothing;

insert into public.nota (empresa_id, id, situacao, origem, competencia, tomador_id, servico_id,
  codigo_tributacao_nacional, codigo_nbs, descricao, cod_municipio_prestacao, valor_servico, base_calculo,
  aliquota_iss, valor_iss, valor_liquido, serie_dps, numero_dps, id_dps, chave_acesso, numero_nfse,
  autorizada_em, documento_id)
values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a4', 'autorizada', 'avulsa',
  '2026-11-01', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2',
  '010601', '113032000', 'Nota de teste do seed', '4301602', 1350.00, 1350.00, 2.0100, 27.14, 1322.86,
  '90001', 1, app.montar_id_dps('4301602', '11222333000181', '90001', 1),
  '43016022112223330001810000000000000126110000000001', '1', now(), '00000000-0000-4000-8000-0000000000a3')
on conflict do nothing;

update public.empresa set proximo_ndps = 2 where id = '00000000-0000-4000-8000-00000000000a' and proximo_ndps = 1;
