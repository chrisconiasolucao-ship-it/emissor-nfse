/**
 * Verificador da cadeia (AT-034). Duas provas:
 * 1) o banco recalcula cada hash (fn_verificar_auditoria) e aponta a primeira linha quebrada;
 * 2) as âncoras diárias guardadas FORA do banco (Vercel Blob) precisam bater com a linha de mesmo id.
 *    A 2ª pega quem reescreveu a cadeia inteira recalculando os hashes, inclusive um administrador.
 */
export type Ancora = { dia: string; ultimoId: number; hash: string };
export type LinhaCadeia = { id: number; hash: string };
export type ResultadoBanco = { primeiraQuebra: number | null; ultimoId: number | null; ultimoHash: string | null };

export type Quebra =
  | { tipo: "hash_recalculado_nao_confere"; linha: number }
  | { tipo: "ancora_diverge"; linha: number; dia: string; esperado: string; encontrado: string | null };

export type ResultadoVerificacao = { integra: boolean; quebras: Quebra[]; ultimoId: number | null; ultimoHash: string | null };

export function compararComAncoras(banco: ResultadoBanco, ancoras: Ancora[], linhas: Map<number, string>): ResultadoVerificacao {
  const quebras: Quebra[] = [];
  if (banco.primeiraQuebra != null) quebras.push({ tipo: "hash_recalculado_nao_confere", linha: banco.primeiraQuebra });
  for (const a of [...ancoras].sort((x, y) => x.ultimoId - y.ultimoId)) {
    const encontrado = linhas.get(a.ultimoId) ?? null;
    if (encontrado !== a.hash) {
      quebras.push({ tipo: "ancora_diverge", linha: a.ultimoId, dia: a.dia, esperado: a.hash, encontrado });
    }
  }
  return { integra: quebras.length === 0, quebras, ultimoId: banco.ultimoId, ultimoHash: banco.ultimoHash };
}

export function descreverQuebra(q: Quebra): string {
  return q.tipo === "hash_recalculado_nao_confere"
    ? `Trilha de auditoria quebrada na linha ${q.linha}: o conteúdo não confere com o hash gravado.`
    : `Trilha de auditoria diverge da âncora de ${q.dia} na linha ${q.linha}${q.encontrado ? "" : " (linha removida)"}.`;
}

/** Leitura no banco (service role) e verificação. As âncoras vêm do Blob, lidas por quem chama. */
export async function verificarCadeia(
  db: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>; from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  ancoras: Ancora[],
): Promise<ResultadoVerificacao> {
  const { data, error } = await db.rpc("fn_verificar_auditoria", { p_desde: 0 });
  if (error) throw new Error(`verificador não rodou: ${error.message}`);
  const r = (Array.isArray(data) ? data[0] : data) as { primeira_quebra: number | null; ultimo_id: number | null; ultimo_hash: string | null } | undefined;
  const ids = ancoras.map((a) => a.ultimoId);
  const linhas = new Map<number, string>();
  if (ids.length > 0) {
    const { data: rows, error: e2 } = await db.from("auditoria").select("id, hash").in("id", ids);
    if (e2) throw new Error(`verificador não leu a trilha: ${e2.message}`);
    for (const l of (rows ?? []) as LinhaCadeia[]) linhas.set(Number(l.id), l.hash);
  }
  return compararComAncoras(
    { primeiraQuebra: r?.primeira_quebra ?? null, ultimoId: r?.ultimo_id ?? null, ultimoHash: r?.ultimo_hash ?? null },
    ancoras,
    linhas,
  );
}
