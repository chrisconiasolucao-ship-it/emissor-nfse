# Emissor NFS-e Nacional — CHRISCON

Emissão de NFS-e no padrão nacional para clientes do Simples Nacional (ME/EPP) e MEI, várias empresas,
com fila, certificado A1 cifrado, trilha de auditoria com hash encadeado e cópia fora do banco.
Stack: Next.js na Vercel + Supabase (Postgres, Auth, Storage, pg_cron).

Especificação: `sdd/features/` (BRAINSTORM, DEFINE, DESIGN) e `sdd/reviews/GOVERNANCA_REVIEW_EMISSOR_NFSE_NACIONAL.md`.

## Ambientes

| Onde | Supabase | Vercel | Receita |
|---|---|---|---|
| Teste | branch persistente `teste` do projeto Pro | Preview | produção restrita (`NFSE_AMBIENTE=restrita`) |
| Produção | branch principal | Production | produção (`NFSE_AMBIENTE=producao`) |

A tela mostra uma faixa "PRODUÇÃO RESTRITA" ou "PRODUÇÃO". O sistema recusa subir se `NFSE_AMBIENTE` não
combina com as URLs da Sefin/ADN.

## Configurar (uma vez)

1. **Supabase**: no projeto Pro, ative Branching e crie o branch persistente `teste`.
2. **Migrations**: aplique `supabase/migrations/0001` a `0010` primeiro no branch `teste`
   (`supabase db push` com o projeto ligado ao branch, ou pelo SQL Editor do branch, na ordem).
   Só depois de testado, no principal.
3. **Vault** (em cada branch): segredos `app_url` (URL da Vercel daquele ambiente) e `worker_secret`
   (mesmo valor de `WORKER_SECRET`). O `0010_cron.sql` agenda: emissão a cada minuto, ADN às 9h, diário às 3h10 (UTC).
4. **Auth**: desligue o cadastro aberto (já em `supabase/config.toml`). Se o plano permitir, ligue o hook
   "Password Verification Attempt" apontando para `public.hook_verificacao_senha`.
5. **Primeiro usuário do escritório**: crie em Authentication → Users e grave o perfil no SQL Editor:
   `insert into perfil_usuario (usuario_id, papel, nome, email) values ('<id>', 'escritorio_admin', '<nome>', '<email>');`
   Os demais usuários são criados pela tela (Empresas → usuários).
6. **Vercel**: importe o repositório, ligue a integração Supabase (preenche URL e chaves por ambiente) e
   cadastre as variáveis de `.env.example` em Preview e em Production, com valores diferentes:
   `CERT_MASTER_KEY` (`openssl rand -base64 32`), `WORKER_SECRET` (`openssl rand -hex 32`), `NFSE_AMBIENTE`,
   `SEFIN_BASE_URL`, `ADN_BASE_URL`, `BLOB_READ_WRITE_TOKEN` (crie um Blob store privado).
7. **Municípios**: entre como escritório, vá em Municípios e importe o painel da Receita (repita todo mês).
8. **Empresas**: cadastre (só ME, EPP ou MEI), envie o certificado A1 (.pfx + senha) e crie os usuários do cliente.

A chave `CERT_MASTER_KEY` fica só na Vercel. Sem ela o certificado guardado não abre; perder a chave
exige reenviar os certificados.

## Rodar local

```bash
npm install
cp .env.example .env.local   # preencha com os dados do branch `teste`
npm run dev
```

## Testes e Verify Gate

`npm test` roda os testes unitários e os de integração. Os de integração usam o banco do **branch `teste`**
pelas variáveis `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` (Supabase → branch `teste` →
Connect → conexão direta). Sem `PGHOST` eles falham de propósito; com o banco principal (`PROD_SUPABASE_URL`)
eles se recusam a rodar. Cada teste trabalha dentro de uma transação desfeita no fim.

O Verify Gate do DEFINE:

```bash
npm test && psql -v ON_ERROR_STOP=1 -f sdd/tests/governanca/EMISSOR_NFSE_NACIONAL_G01.sql \
  && psql -v ON_ERROR_STOP=1 -f sdd/tests/governanca/EMISSOR_NFSE_NACIONAL_G04.sql \
  && psql -v ON_ERROR_STOP=1 -f sdd/tests/governanca/EMISSOR_NFSE_NACIONAL_G08.sql \
  && psql -v ON_ERROR_STOP=1 -f sdd/tests/governanca/EMISSOR_NFSE_NACIONAL_G09.sql \
  && psql -v ON_ERROR_STOP=1 -f sdd/tests/governanca/EMISSOR_NFSE_NACIONAL_G10.sql
```

Passa com saída 0. Os scripts G01/G08/G10 precisam de pelo menos 1 nota autorizada ligada a documento no
branch `teste` (o `supabase/seed.sql` grava uma). **Nunca rode os scripts no banco principal.**

Smoke na produção restrita (empresa de teste com certificado já enviado): `npm run smoke:restrita`
(variáveis no topo de `scripts/smoke-restrita.ts`). Emite R$ 1,00, confere XML e DANFSe e cancela.

## Onde fica cada coisa

| Pasta | O quê |
|---|---|
| `supabase/migrations` | tabelas, RLS, travas de imutabilidade, trilha, fila, login, cron |
| `src/lib/nfse` | DPS, assinatura, Sefin, ADN, leitura de NFS-e, eventos, regra de município |
| `src/lib/crypto` | cofre AES-GCM e leitura do pfx |
| `src/lib/fila` | worker de emissão e novas tentativas (5/15/60 min) |
| `src/lib/auditoria` | trilha, log de segurança, âncora diária no Vercel Blob, verificador |
| `src/lib/importacao` | planilha (até 30 notas), repetir mês, nota parecida, municípios |
| `src/app` | telas, Server Actions e rotas dos workers |

## A conferir na produção restrita antes de ir para produção

Caminhos e nomes de campo da Sefin e do ADN; `regApTribSN` para ME/EPP; competência no 1º dia do mês;
formato do arquivo do painel de municípios.
