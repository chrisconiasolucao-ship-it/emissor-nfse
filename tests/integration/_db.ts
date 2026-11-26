import { randomUUID } from "node:crypto";
import pg from "pg";

/**
 * Banco dos testes de integração: o branch `teste` do Supabase (variáveis PG*), nunca o principal.
 * Sem PGHOST o teste FALHA (não pula): um gate verde sem banco seria mentira.
 * Tudo roda dentro de uma transação desfeita no fim (ROLLBACK): nada fica gravado.
 */
export function exigirBancoDeTeste(): pg.ClientConfig {
  const host = process.env.PGHOST;
  if (!host) throw new Error("PGHOST não definido: os testes de integração precisam do branch `teste` (veja o README).");
  const prod = process.env.PROD_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\./)?.[1];
  const alvo = `${host} ${process.env.PGUSER ?? ""}`;
  if (prod && alvo.includes(prod)) throw new Error("PGHOST/PGUSER apontam para o banco principal. Os testes só rodam no branch `teste`.");
  return { ssl: /localhost|^\/|127\.0\.0\.1/.test(host) ? false : { rejectUnauthorized: false } };
}

export type Tx = pg.PoolClient & { uuid: () => string };

let pool: pg.Pool | undefined;
function conexao(): pg.Pool {
  pool ??= new pg.Pool({ ...exigirBancoDeTeste(), max: 2 });
  return pool;
}
export async function fecharBanco() {
  await pool?.end();
  pool = undefined;
}

export async function emTransacao(fn: (tx: Tx) => Promise<void>): Promise<void> {
  const c = (await conexao().connect()) as Tx;
  c.uuid = randomUUID;
  try {
    await c.query("begin");
    await fn(c);
  } finally {
    await c.query("rollback").catch(() => undefined);
    c.release();
  }
}

/** Troca o papel dentro da transação, como o PostgREST faz. */
export async function como(tx: Tx, papel: "authenticated" | "service_role" | "postgres", usuario?: string) {
  await tx.query("reset role");
  if (papel !== "postgres") await tx.query(`set local role ${papel}`);
  const sub = usuario ?? "";
  await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [
    sub,
    papel,
    JSON.stringify({ sub, role: papel }),
  ]);
}

/** Espera recusa; devolve o SQLSTATE. Usa savepoint para a transação continuar. */
export async function recusa(tx: Tx, sql: string, params: unknown[] = []): Promise<string> {
  await tx.query("savepoint s");
  try {
    await tx.query(sql, params);
  } catch (e) {
    await tx.query("rollback to savepoint s");
    return String((e as { code?: string }).code ?? "erro");
  }
  await tx.query("release savepoint s");
  throw new Error(`deveria ter sido recusado: ${sql}`);
}

/** Duas empresas com usuários, tomador, nota autorizada e documento. Ids novos a cada chamada. */
export async function cenario(tx: Tx) {
  await como(tx, "postgres");
  const id = () => tx.uuid();
  const A = id();
  const B = id();
  const u = { escritorio: id(), adminA: id(), userA: id(), userB: id() };
  const cnpjA = `9${String(Date.now()).slice(-12)}1`.slice(0, 14);
  const cnpjB = `8${String(Date.now()).slice(-12)}2`.slice(0, 14);
  await tx.query("insert into empresa (id, cnpj, razao_social, regime, cod_municipio) values ($1,$2,'EMPRESA A','ME','4301602'), ($3,$4,'EMPRESA B','EPP','4314902')", [A, cnpjA, B, cnpjB]);
  for (const [k, v] of Object.entries(u)) await tx.query("insert into auth.users (id, email) values ($1, $2)", [v, `${k}.${v.slice(0, 8)}@teste.invalid`]);
  await tx.query(
    `insert into perfil_usuario (usuario_id, empresa_id, papel, email) values
     ($1, null, 'escritorio_admin', 'esc@teste.invalid'), ($2, $5, 'cliente_admin', 'adminA@teste.invalid'),
     ($3, $5, 'cliente_usuario', 'userA@teste.invalid'), ($4, $6, 'cliente_usuario', 'userB@teste.invalid')`,
    [u.escritorio, u.adminA, u.userA, u.userB, A, B],
  );
  const tomA = id();
  const tomB = id();
  await tx.query("insert into tomador (empresa_id, id, tipo_documento, documento, nome) values ($1,$2,'CPF','52998224725','TOMADOR A'), ($3,$4,'CPF','11144477735','TOMADOR B')", [A, tomA, B, tomB]);
  const docA = id();
  const docB = id();
  const h = (s: string) => s.repeat(64).slice(0, 64);
  await tx.query(
    "insert into documento (empresa_id, id, tipo, storage_path, sha256, tamanho, content_type) values ($1,$2,'xml_autorizado',$3,$4,10,'application/xml'), ($5,$6,'xml_autorizado',$7,$8,10,'application/xml')",
    [A, docA, `${A}/notas/x.xml`, h("a"), B, docB, `${B}/notas/y.xml`, h("b")],
  );
  const notaA = id();
  const notaB = id();
  const chave = (c: string) => `43${c}`.padEnd(50, "0").slice(0, 50);
  await tx.query(
    `insert into nota (empresa_id, id, situacao, tomador_id, descricao, valor_servico, competencia, codigo_tributacao_nacional, cod_municipio_prestacao, chave_acesso, documento_id, serie_dps, numero_dps, id_dps)
     values ($1,$2,'autorizada',$3,'Serviço A',1350.00,'2026-11-01','010601','4301602',$4,$5,'900',900001,$6),
            ($7,$8,'autorizada',$9,'Serviço B',200.00,'2026-11-01','010601','4314902',$10,$11,'900',900001,$12)`,
    [A, notaA, tomA, chave(cnpjA), docA, `DPS${cnpjA}A`.slice(0, 45), B, notaB, tomB, chave(cnpjB), docB, `DPS${cnpjB}B`.slice(0, 45)],
  );
  return { A, B, u, tomA, tomB, docA, docB, notaA, notaB, cnpjA, cnpjB };
}
