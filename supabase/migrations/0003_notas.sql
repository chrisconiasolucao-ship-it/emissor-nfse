-- 0003 — notas, documentos, eventos e importações.
-- Nomes fixos por causa de sdd/tests/governanca: nota, situacao, descricao, chave_acesso, documento_id,
-- documento, sha256. Valores em numeric (AT-030, G09). Chaves naturais UNIQUE (AT-031, G10).

-- AT-029 / G08: documento guardado uma vez, por hash; nunca se altera (trigger em 0005).
create table public.documento (
  empresa_id uuid not null references public.empresa (id),
  id uuid not null default gen_random_uuid() unique,
  tipo public.tipo_documento not null,
  storage_path text not null,
  sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
  tamanho bigint not null check (tamanho >= 0),
  content_type text not null,
  nome_original text,
  nota_id uuid,                 -- DANFSe/evento baixados depois da autorização ligam-se por aqui
  criado_em timestamptz not null default now(),
  criado_por uuid,
  primary key (empresa_id, id),
  unique (empresa_id, tipo, sha256)
);

create table public.importacao (
  empresa_id uuid not null references public.empresa (id),
  id uuid not null default gen_random_uuid(),
  tipo text not null check (tipo in ('planilha', 'xml', 'adn', 'repeticao')),
  documento_id uuid,
  competencia date,
  linhas integer not null default 0,
  notas_criadas integer not null default 0,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  primary key (empresa_id, id),
  foreign key (empresa_id, documento_id) references public.documento (empresa_id, id),
  unique (empresa_id, documento_id)
);
-- repetir o mesmo mês duas vezes também não duplica (AT-031)
create unique index importacao_repeticao_unica on public.importacao (empresa_id, competencia) where tipo = 'repeticao';

create table public.nota (
  empresa_id uuid not null references public.empresa (id),
  id uuid not null default gen_random_uuid(),
  situacao public.situacao_nota not null default 'rascunho',
  origem public.origem_nota not null default 'avulsa',
  competencia date check (competencia = date_trunc('month', competencia)::date),
  tomador_id uuid,
  servico_id uuid,
  codigo_tributacao_nacional char(6),
  codigo_nbs varchar(9),
  descricao text not null,
  cod_municipio_prestacao char(7),
  valor_servico numeric(18, 2) check (valor_servico > 0),
  valor_deducoes numeric(18, 2) not null default 0 check (valor_deducoes >= 0),
  base_calculo numeric(18, 2),
  aliquota_iss numeric(7, 4),
  valor_iss numeric(18, 2),
  iss_retido boolean not null default false,
  valor_liquido numeric(18, 2),
  -- numeração da DPS (série própria do sistema, AT-009)
  serie_dps varchar(5),
  numero_dps bigint,
  id_dps varchar(45) unique,
  -- autorização
  chave_acesso varchar(50) unique,
  numero_nfse text,
  autorizada_em timestamptz,
  documento_id uuid,            -- XML autorizado
  danfse_documento_id uuid,
  -- origem e substituição
  documento_origem_id uuid,
  importacao_id uuid,
  nota_substituida_id uuid,
  codigo_motivo_substituicao char(2) check (codigo_motivo_substituicao in ('01', '02', '03', '04', '05', '99')),
  motivo_substituicao text,
  -- fila
  tentativas smallint not null default 0,
  proxima_tentativa_em timestamptz,
  enfileirada_em timestamptz,
  codigo_rejeicao text,
  motivo_rejeicao text,
  duplicidade_confirmada boolean not null default false,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, id),
  unique (empresa_id, serie_dps, numero_dps),
  -- G13: chave composta impede apontar para tomador/documento/nota de outra empresa
  foreign key (empresa_id, tomador_id) references public.tomador (empresa_id, id),
  foreign key (empresa_id, servico_id) references public.servico (empresa_id, id),
  foreign key (empresa_id, documento_id) references public.documento (empresa_id, id),
  foreign key (empresa_id, danfse_documento_id) references public.documento (empresa_id, id),
  foreign key (empresa_id, documento_origem_id) references public.documento (empresa_id, id),
  foreign key (empresa_id, importacao_id) references public.importacao (empresa_id, id),
  foreign key (empresa_id, nota_substituida_id) references public.nota (empresa_id, id)
);
alter table public.documento
  add constraint documento_nota_fk foreign key (empresa_id, nota_id) references public.nota (empresa_id, id);

create index nota_fila on public.nota (proxima_tentativa_em nulls first, enfileirada_em) where situacao = 'na_fila';
create index nota_empresa_competencia on public.nota (empresa_id, competencia);
create trigger nota_atualizado before update on public.nota
  for each row execute function app.tocar_atualizado_em();

-- Na fila, a nota precisa estar completa.
-- security definer: a checagem da substituição chama app.usuario_pode_administrar, que a tela não executa
create or replace function app.trg_nota_completa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.situacao = 'na_fila' and (old is null or old.situacao is distinct from 'na_fila') then
    if new.tomador_id is null or new.valor_servico is null or new.competencia is null
       or new.codigo_tributacao_nacional is null or new.cod_municipio_prestacao is null then
      raise exception 'nota incompleta: tomador, valor, competência, código de tributação e município são obrigatórios'
        using errcode = '23514';
    end if;
    -- substituição: quem pede precisa administrar a empresa, com motivo, e a nota antiga precisa estar
    -- autorizada (AT-014, AT-016); conferido no banco, não só na tela
    if new.nota_substituida_id is not null then
      if not app.usuario_pode_administrar(new.criado_por, new.empresa_id) then
        raise exception 'usuário sem permissão para substituir nota' using errcode = '42501';
      end if;
      if new.codigo_motivo_substituicao is null or coalesce(length(trim(new.motivo_substituicao)), 0) < 15 then
        raise exception 'substituição exige código e motivo (mínimo 15 caracteres)' using errcode = '23514';
      end if;
      if not exists (select 1 from public.nota a where a.empresa_id = new.empresa_id and a.id = new.nota_substituida_id
                       and a.situacao = 'autorizada') then
        raise exception 'só nota autorizada pode ser substituída' using errcode = 'P0001';
      end if;
    end if;
    new.enfileirada_em := coalesce(new.enfileirada_em, now());
  end if;
  return new;
end $$;
create trigger nota_completa before insert or update on public.nota
  for each row execute function app.trg_nota_completa();

create table public.evento_nota (
  empresa_id uuid not null,
  id uuid not null default gen_random_uuid(),
  nota_id uuid not null,
  tipo text not null check (tipo in ('cancelamento', 'substituicao')),
  codigo_motivo text not null,
  motivo text not null check (length(trim(motivo)) >= 15),
  nota_substituta_id uuid,
  protocolo text,
  documento_id uuid,
  registrado_por uuid not null,
  registrado_em timestamptz not null default now(),
  primary key (empresa_id, id),
  foreign key (empresa_id, nota_id) references public.nota (empresa_id, id),
  foreign key (empresa_id, nota_substituta_id) references public.nota (empresa_id, id),
  foreign key (empresa_id, documento_id) references public.documento (empresa_id, id)
);

-- Distribuição ADN: último NSU por CNPJ (AT-021).
create table public.adn_cursor (
  empresa_id uuid primary key references public.empresa (id),
  ultimo_nsu bigint not null default 0,
  atualizado_em timestamptz not null default now()
);
