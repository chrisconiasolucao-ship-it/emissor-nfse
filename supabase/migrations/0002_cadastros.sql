-- 0002 — cadastros: tomador, serviço, certificado (metadados) e situação dos municípios.

create table public.tomador (
  empresa_id uuid not null references public.empresa (id),
  id uuid not null default gen_random_uuid(),
  tipo_documento text not null check (tipo_documento in ('CPF', 'CNPJ', 'EXTERIOR')),
  documento varchar(20) not null,
  nome text not null,
  email text,
  telefone text,
  cep char(8),
  cod_municipio char(7),
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, id),
  unique (empresa_id, tipo_documento, documento),
  constraint tomador_documento_valido check (
    (tipo_documento = 'CPF' and documento ~ '^\d{11}$')
    or (tipo_documento = 'CNPJ' and documento ~ '^\d{14}$')
    or tipo_documento = 'EXTERIOR'
  )
);
create trigger tomador_atualizado before update on public.tomador
  for each row execute function app.tocar_atualizado_em();

create table public.servico (
  empresa_id uuid not null references public.empresa (id),
  id uuid not null default gen_random_uuid(),
  codigo_tributacao_nacional char(6) not null check (codigo_tributacao_nacional ~ '^\d{6}$'),
  codigo_nbs varchar(9) check (codigo_nbs ~ '^\d{9}$'),
  descricao text not null,
  aliquota_iss numeric(7, 4) check (aliquota_iss >= 0 and aliquota_iss <= 100),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  primary key (empresa_id, id)
);

-- Certificado A1: o pfx cifrado fica no bucket `certificados`; aqui ficam metadados e a senha cifrada.
-- AT-011: clientes nunca leem storage_path, pfx_cripto nem senha_cripto (privilégio por coluna em 0006).
create table public.certificado (
  empresa_id uuid not null references public.empresa (id),
  id uuid not null default gen_random_uuid(),
  storage_path text not null,
  pfx_cripto jsonb not null,      -- { iv, tag, keyVersion } do arquivo cifrado
  senha_cripto jsonb not null,    -- { iv, tag, dados, keyVersion }
  sha256 char(64) not null,
  titular text not null,
  cnpj_titular char(14),
  valido_de timestamptz not null,
  valido_ate timestamptz not null,
  ativo boolean not null default true,
  enviado_por uuid not null,
  enviado_em timestamptz not null default now(),
  alerta_30_em timestamptz,
  alerta_15_em timestamptz,
  primary key (empresa_id, id)
);
create unique index certificado_um_ativo on public.certificado (empresa_id) where ativo;

-- Decision 8: situação dos municípios importada do painel da RFB.
create table public.municipio_situacao (
  cod_ibge char(7) primary key check (cod_ibge ~ '^\d{7}$'),
  nome text not null,
  uf char(2) not null,
  conveniado boolean not null default false,
  ativo_operacional boolean not null default false,
  emissor_nacional boolean not null default false,
  importado_em timestamptz not null default now(),
  importado_por uuid
);
