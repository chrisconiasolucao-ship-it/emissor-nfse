-- 0006 — RLS: cada usuário só lê e grava o que é da sua empresa (AT-010, AT-032 / G13).
-- O escritório vê tudo. Sem FORCE: o dono das tabelas (postgres) roda migrations e os scripts de governança.

alter table public.empresa enable row level security;
alter table public.perfil_usuario enable row level security;
alter table public.tomador enable row level security;
alter table public.servico enable row level security;
alter table public.certificado enable row level security;
alter table public.municipio_situacao enable row level security;
alter table public.documento enable row level security;
alter table public.importacao enable row level security;
alter table public.nota enable row level security;
alter table public.evento_nota enable row level security;
alter table public.adn_cursor enable row level security;
alter table public.auditoria enable row level security;
alter table public.log_seguranca enable row level security;
alter table public.ancora_auditoria enable row level security;
alter table public.aviso enable row level security;

-- Começa do zero: nada para anon; authenticated só o que for concedido abaixo.
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

-- empresa
grant select, update on public.empresa to authenticated;
grant insert on public.empresa to authenticated;
create policy empresa_ler on public.empresa for select to authenticated using (app.pode_ver(id));
create policy empresa_criar on public.empresa for insert to authenticated with check (app.e_escritorio());
create policy empresa_alterar on public.empresa for update to authenticated
  using (app.pode_administrar(id)) with check (app.pode_administrar(id));

-- perfil_usuario: leitura do próprio perfil, dos colegas da empresa (admin) e de todos (escritório).
-- Criação de usuário passa pelo servidor (Auth admin API) — sem escrita direta.
grant select on public.perfil_usuario to authenticated;
create policy perfil_ler on public.perfil_usuario for select to authenticated
  using (usuario_id = auth.uid() or app.e_escritorio()
         or (empresa_id is not null and app.pode_administrar(empresa_id)));

-- tomador e serviço: CRUD dentro da própria empresa
grant select, insert, update, delete on public.tomador, public.servico to authenticated;
create policy tomador_ler on public.tomador for select to authenticated using (app.pode_ver(empresa_id));
create policy tomador_criar on public.tomador for insert to authenticated with check (app.pode_ver(empresa_id));
create policy tomador_alterar on public.tomador for update to authenticated
  using (app.pode_ver(empresa_id)) with check (app.pode_ver(empresa_id));
create policy tomador_excluir on public.tomador for delete to authenticated using (app.pode_ver(empresa_id));
create policy servico_ler on public.servico for select to authenticated using (app.pode_ver(empresa_id));
create policy servico_criar on public.servico for insert to authenticated with check (app.pode_ver(empresa_id));
create policy servico_alterar on public.servico for update to authenticated
  using (app.pode_ver(empresa_id)) with check (app.pode_ver(empresa_id));
create policy servico_excluir on public.servico for delete to authenticated using (app.pode_ver(empresa_id));

-- certificado: só metadados, por coluna (AT-011). Nenhuma escrita pela tela.
grant select (empresa_id, id, titular, cnpj_titular, valido_de, valido_ate, ativo, enviado_por, enviado_em)
  on public.certificado to authenticated;
create policy certificado_ler on public.certificado for select to authenticated using (app.pode_ver(empresa_id));

-- municípios: todos leem; só o escritório importa
grant select, insert, update, delete on public.municipio_situacao to authenticated;
create policy municipio_ler on public.municipio_situacao for select to authenticated using (true);
create policy municipio_criar on public.municipio_situacao for insert to authenticated with check (app.e_escritorio());
create policy municipio_alterar on public.municipio_situacao for update to authenticated
  using (app.e_escritorio()) with check (app.e_escritorio());
create policy municipio_excluir on public.municipio_situacao for delete to authenticated using (app.e_escritorio());

-- documento, importação, evento: leitura por empresa; escrita só pelo servidor
grant select on public.documento, public.importacao, public.evento_nota to authenticated;
create policy documento_ler on public.documento for select to authenticated using (app.pode_ver(empresa_id));
create policy importacao_ler on public.importacao for select to authenticated using (app.pode_ver(empresa_id));
create policy evento_ler on public.evento_nota for select to authenticated using (app.pode_ver(empresa_id));

-- nota: rascunho pela tela; transições controladas em 0005 (trg_nota_transicao_cliente)
grant select, insert, update, delete on public.nota to authenticated;
create policy nota_ler on public.nota for select to authenticated using (app.pode_ver(empresa_id));
create policy nota_criar on public.nota for insert to authenticated with check (app.pode_ver(empresa_id));
create policy nota_alterar on public.nota for update to authenticated
  using (app.pode_ver(empresa_id)) with check (app.pode_ver(empresa_id));
create policy nota_excluir on public.nota for delete to authenticated
  using (app.pode_ver(empresa_id) and situacao = 'rascunho');

-- trilha: cliente lê a da própria empresa; escritório lê tudo
grant select on public.auditoria to authenticated;
create policy auditoria_ler on public.auditoria for select to authenticated
  using (app.e_escritorio() or (empresa_id is not null and app.pode_ver(empresa_id)));

-- log de segurança e âncoras: só o escritório lê
grant select on public.log_seguranca, public.ancora_auditoria to authenticated;
create policy log_ler on public.log_seguranca for select to authenticated using (app.e_escritorio());
create policy ancora_ler on public.ancora_auditoria for select to authenticated using (app.e_escritorio());

-- avisos: escritório lê e marca como lido
grant select on public.aviso to authenticated;
grant update (lido_em, lido_por) on public.aviso to authenticated;
create policy aviso_ler on public.aviso for select to authenticated using (app.e_escritorio());
create policy aviso_marcar on public.aviso for update to authenticated
  using (app.e_escritorio()) with check (app.e_escritorio());

-- adn_cursor: nenhum acesso pela tela (policy nenhuma = zero linhas)

-- Sequências das tabelas com identity não são usadas pela tela.
revoke usage on all sequences in schema public from anon, authenticated;
