-- 0001 — base: extensões, tipos, empresa, perfis e funções de permissão.
-- Decision 5 (isolamento por empresa_id). Roda no Supabase (auth.uid(), papéis anon/authenticated/service_role).

create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;
grant usage on schema app to authenticated, service_role;

create type public.papel as enum ('escritorio_admin', 'escritorio_operador', 'cliente_admin', 'cliente_usuario');
create type public.regime_empresa as enum ('ME', 'EPP', 'MEI');
create type public.situacao_nota as enum ('rascunho', 'na_fila', 'enviando', 'autorizada', 'rejeitada', 'cancelada', 'substituida');
create type public.origem_nota as enum ('avulsa', 'modelo', 'repeticao', 'planilha');
create type public.tipo_documento as enum ('xml_autorizado', 'danfse', 'xml_evento', 'planilha', 'xml_origem', 'municipios');

create or replace function app.tocar_atualizado_em() returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

-- AT-024: só Simples (ME/EPP) e MEI. opSimpNac 2 = MEI, 3 = ME/EPP.
create table public.empresa (
  id uuid primary key default gen_random_uuid(),
  cnpj char(14) not null unique check (cnpj ~ '^\d{14}$'),
  razao_social text not null,
  nome_fantasia text,
  regime public.regime_empresa not null,
  op_simp_nac smallint not null generated always as (case when regime = 'MEI' then 2 else 3 end) stored,
  inscricao_municipal text,
  cod_municipio char(7) not null check (cod_municipio ~ '^\d{7}$'),
  email text,
  telefone text,
  serie_dps varchar(5) not null default '90001' check (serie_dps ~ '^\d{1,5}$'),
  proximo_ndps bigint not null default 1 check (proximo_ndps > 0),
  pausada boolean not null default false,
  motivo_pausa text,
  ativa boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create trigger empresa_atualizado before update on public.empresa
  for each row execute function app.tocar_atualizado_em();

-- Um perfil por usuário: escritório (sem empresa) ou cliente (com empresa).
create table public.perfil_usuario (
  usuario_id uuid primary key references auth.users (id) on delete cascade,
  empresa_id uuid references public.empresa (id),
  papel public.papel not null,
  nome text,
  email text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  constraint perfil_empresa_coerente check (
    (papel in ('escritorio_admin', 'escritorio_operador') and empresa_id is null)
    or (papel in ('cliente_admin', 'cliente_usuario') and empresa_id is not null)
  )
);

create or replace function app.papel_atual() returns public.papel
language sql stable security definer set search_path = public as $$
  select papel from public.perfil_usuario where usuario_id = auth.uid() and ativo
$$;

create or replace function app.e_escritorio() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app.papel_atual() in ('escritorio_admin', 'escritorio_operador'), false)
$$;

create or replace function app.empresa_do_usuario() returns uuid
language sql stable security definer set search_path = public as $$
  select empresa_id from public.perfil_usuario where usuario_id = auth.uid() and ativo
$$;

-- Leitura e escrita de dados de negócio da empresa.
create or replace function app.pode_ver(p_empresa_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.e_escritorio() or (p_empresa_id is not null and p_empresa_id = app.empresa_do_usuario())
$$;

-- Cancelar, substituir, administrar usuários e dados da empresa (AT-014).
create or replace function app.pode_administrar(p_empresa_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.e_escritorio()
      or (app.papel_atual() = 'cliente_admin' and p_empresa_id = app.empresa_do_usuario())
$$;

-- Mesmas regras, para um usuário informado (usado pelo servidor com service role).
create or replace function app.usuario_pode_administrar(p_usuario uuid, p_empresa_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perfil_usuario p
     where p.usuario_id = p_usuario and p.ativo
       and (p.papel in ('escritorio_admin', 'escritorio_operador')
            or (p.papel = 'cliente_admin' and p.empresa_id = p_empresa_id))
  )
$$;

create or replace function app.usuario_pode_ver(p_usuario uuid, p_empresa_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perfil_usuario p
     where p.usuario_id = p_usuario and p.ativo
       and (p.papel in ('escritorio_admin', 'escritorio_operador') or p.empresa_id = p_empresa_id)
  )
$$;

revoke all on function app.usuario_pode_administrar(uuid, uuid), app.usuario_pode_ver(uuid, uuid) from public, anon, authenticated;
grant execute on function app.papel_atual(), app.e_escritorio(), app.empresa_do_usuario(),
  app.pode_ver(uuid), app.pode_administrar(uuid) to authenticated;

-- Cliente admin não muda CNPJ, regime, numeração nem pausa (só o escritório).
create or replace function app.trg_empresa_campos_do_escritorio() returns trigger
language plpgsql as $$
begin
  if auth.role() = 'authenticated' and not app.e_escritorio() then
    if new.cnpj is distinct from old.cnpj or new.regime is distinct from old.regime
       or new.serie_dps is distinct from old.serie_dps or new.proximo_ndps is distinct from old.proximo_ndps
       or new.pausada is distinct from old.pausada or new.ativa is distinct from old.ativa
       or new.cod_municipio is distinct from old.cod_municipio then
      raise exception 'só o escritório altera CNPJ, regime, município, numeração ou pausa' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger empresa_campos_do_escritorio before update on public.empresa
  for each row execute function app.trg_empresa_campos_do_escritorio();
