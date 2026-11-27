import type { ModeloNota } from "./nfse-parser";

/** Colunas de resumo do documento (migration 0015): papel da empresa na nota e a outra parte. */
export type ResumoDocumento = {
  papel: "prestada" | "tomada" | null;
  outra_parte: string | null;
  outra_parte_documento: string | null;
  numero_nfse: string | null;
  competencia: string | null;
  valor: string | null;
};

export function resumoDaNfse(m: ModeloNota, cnpjEmpresa: string): ResumoDocumento {
  const prestada = m.prestadorCnpj === cnpjEmpresa;
  const tomada = !prestada && m.tomador?.documento === cnpjEmpresa;
  return {
    papel: prestada ? "prestada" : tomada ? "tomada" : null,
    outra_parte: prestada ? (m.tomador?.nome || null) : (m.prestadorNome ?? null),
    outra_parte_documento: prestada ? (m.tomador?.documento || null) : (m.prestadorCnpj ?? null),
    numero_nfse: m.numeroNfse,
    competencia: m.competencia,
    valor: m.valorServico,
  };
}

/**
 * Grava o documento com o resumo. Enquanto a migration 0015 não estiver no banco, grava sem as colunas novas
 * (o PostgREST recusa coluna desconhecida com PGRST204 / 42703).
 */
export async function inserirComResumo<T>(
  inserir: (linha: Record<string, unknown>) => PromiseLike<{ data: T; error: { code?: string; message: string } | null }>,
  base: Record<string, unknown>,
  resumo: ResumoDocumento | null,
): Promise<{ data: T; error: { code?: string; message: string } | null }> {
  if (!resumo) return inserir(base);
  const r = await inserir({ ...base, ...resumo });
  if (r.error && (r.error.code === "PGRST204" || r.error.code === "42703")) return inserir(base);
  return r;
}
