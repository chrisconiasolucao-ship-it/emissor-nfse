-- 0016 — envio da NFS-e ao tomador (pedido do José, 27/11/2026): e-mail com o DANFSe e o XML anexados (Resend)
-- e WhatsApp por link wa.me com um link temporário para baixar os dois. Cada envio fica registrado na nota.
-- Escrita só pelo servidor (service role), depois de conferir quem pede; a tela só lê.

create table if not exists public.envio_nota (
  empresa_id uuid not null references public.empresa (id),
  id uuid not null default gen_random_uuid(),
  nota_id uuid not null,
  canal text not null check (canal in ('email', 'whatsapp')),
  destinatario text not null,
  situacao text not null check (situacao in ('enviado', 'falhou', 'link_aberto')),
  provedor_id text,
  erro text,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  primary key (empresa_id, id),
  foreign key (empresa_id, nota_id) references public.nota (empresa_id, id)
);
create index if not exists envio_nota_por_nota on public.envio_nota (empresa_id, nota_id, criado_em desc);

alter table public.envio_nota enable row level security;
revoke all on public.envio_nota from anon, authenticated;
grant select on public.envio_nota to authenticated;
drop policy if exists envio_ler on public.envio_nota;
create policy envio_ler on public.envio_nota for select to authenticated using (app.pode_ver(empresa_id));

drop trigger if exists auditar on public.envio_nota;
create trigger auditar after insert on public.envio_nota for each row execute function app.trg_auditar_mudanca();

comment on table public.envio_nota is 'Envios da NFS-e ao tomador: e-mail (Resend, com PDF e XML) ou WhatsApp (wa.me com link temporário).';
