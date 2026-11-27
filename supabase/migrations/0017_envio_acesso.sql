-- 0017 — o que o tomador fez com o envio (pedido do José, 27/11/2026): abriu o link, baixou o PDF ou o XML
-- (WhatsApp e e-mail) e provável abertura do e-mail (imagem invisível; aproximado). Gravado pelo servidor
-- nas rotas públicas /n/<token>; a tela só lê. Download de anexo de dentro do e-mail não é rastreável.

create table if not exists public.envio_acesso (
  empresa_id uuid not null references public.empresa (id),
  id uuid not null default gen_random_uuid(),
  nota_id uuid not null,
  envio_id uuid,
  tipo text not null check (tipo in ('abriu_link', 'baixou_danfse', 'baixou_xml', 'abriu_email')),
  ip inet,
  navegador text,
  criado_em timestamptz not null default now(),
  primary key (empresa_id, id),
  foreign key (empresa_id, nota_id) references public.nota (empresa_id, id),
  foreign key (empresa_id, envio_id) references public.envio_nota (empresa_id, id)
);
create index if not exists envio_acesso_por_nota on public.envio_acesso (empresa_id, nota_id, criado_em desc);

alter table public.envio_acesso enable row level security;
revoke all on public.envio_acesso from anon, authenticated;
grant select on public.envio_acesso to authenticated;
drop policy if exists envio_acesso_ler on public.envio_acesso;
create policy envio_acesso_ler on public.envio_acesso for select to authenticated using (app.pode_ver(empresa_id));

comment on table public.envio_acesso is 'Acessos do tomador ao envio: abriu o link, baixou PDF/XML, provável abertura do e-mail.';
