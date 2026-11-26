/**
 * Classifica a resposta da Sefin (AT-005, AT-006):
 * - "tecnico": rede, timeout, 5xx, 429 → nova tentativa;
 * - "dado": rejeição de negócio (4xx com lista de erros) → Rejeitada, sem nova tentativa.
 * As mensagens da Sefin já vêm em português; aqui só se padroniza e se acrescenta orientação nos casos comuns.
 */
export type ErroSefin = { codigo: string; descricao: string; complemento?: string };
export type Classificacao = { tipo: "tecnico" | "dado"; codigo: string; mensagem: string };

const ORIENTACAO: Record<string, string> = {
  E0008: "Já existe nota para esta DPS (número repetido).",
  E0014: "A DPS informada já foi utilizada.",
};

export class ErroTecnicoSefin extends Error {
  constructor(public detalhe: string, public status?: number, public corpo?: string) {
    super(detalhe);
  }
}

export function lerErros(corpo: unknown): ErroSefin[] {
  if (!corpo || typeof corpo !== "object") return [];
  const o = corpo as Record<string, unknown>;
  const lista = (o.erros ?? o.Erros ?? o.erro ?? o.Erro) as unknown;
  const arr = Array.isArray(lista) ? lista : lista ? [lista] : [];
  return arr
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      codigo: String(e.Codigo ?? e.codigo ?? "SEM_CODIGO"),
      descricao: String(e.Descricao ?? e.descricao ?? e.mensagem ?? "Erro não descrito pela Receita"),
      complemento: e.Complemento != null || e.complemento != null ? String(e.Complemento ?? e.complemento) : undefined,
    }));
}

export function classificar(status: number | undefined, corpo: unknown): Classificacao {
  if (status === undefined || status >= 500 || status === 429 || status === 408) {
    return { tipo: "tecnico", codigo: `HTTP_${status ?? "REDE"}`, mensagem: "Receita indisponível ou lenta" };
  }
  const erros = lerErros(corpo);
  if (status >= 400 && erros.length === 0) {
    // 4xx sem lista de erros (ex.: 400 genérico, 401/403 de certificado) não é dado do usuário a corrigir
    return status === 401 || status === 403
      ? { tipo: "dado", codigo: `HTTP_${status}`, mensagem: "A Receita recusou o certificado digital desta empresa." }
      : { tipo: "tecnico", codigo: `HTTP_${status}`, mensagem: "Resposta inesperada da Receita" };
  }
  const primeiro = erros[0] ?? { codigo: "SEM_CODIGO", descricao: "Rejeitada pela Receita" };
  const partes = erros.map((e) => `${e.codigo}: ${e.descricao}${e.complemento ? ` (${e.complemento})` : ""}`);
  const dica = ORIENTACAO[primeiro.codigo];
  return { tipo: "dado", codigo: primeiro.codigo, mensagem: (dica ? `${dica} ` : "") + partes.join(" | ") };
}
