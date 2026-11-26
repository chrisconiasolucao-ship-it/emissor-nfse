import { iguais } from "@/lib/money";

/**
 * Nota parecida (AT-022): mesma empresa, tomador, valor, descrição e mês de outra nota não
 * cancelada/substituída/rejeitada pede confirmação antes de ir para a fila. Arquivo repetido,
 * chave de acesso ou DPS repetida não passam por aqui: o banco recusa (AT-031).
 */
export type NotaComparavel = {
  id: string;
  empresaId: string;
  tomadorId: string | null;
  valorServico: string | null;
  descricao: string;
  competencia: string | null;
  situacao: string;
};

const SITUACOES_QUE_CONTAM = new Set(["rascunho", "na_fila", "enviando", "autorizada"]);

export const normalizarDescricao = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

export function parecidas(nova: Omit<NotaComparavel, "id" | "situacao"> & { id?: string }, existentes: NotaComparavel[]): NotaComparavel[] {
  if (!nova.tomadorId || !nova.valorServico || !nova.competencia) return [];
  const desc = normalizarDescricao(nova.descricao);
  return existentes.filter(
    (e) =>
      e.id !== nova.id &&
      SITUACOES_QUE_CONTAM.has(e.situacao) &&
      e.empresaId === nova.empresaId &&
      e.tomadorId === nova.tomadorId &&
      e.competencia?.slice(0, 7) === nova.competencia!.slice(0, 7) &&
      e.valorServico != null &&
      iguais(e.valorServico, nova.valorServico!) &&
      normalizarDescricao(e.descricao) === desc,
  );
}

export function mensagemDuplicidade(n: number): string {
  return n === 1
    ? "Já existe uma nota com o mesmo tomador, valor, descrição e mês. Confirme se quer emitir outra."
    : `Já existem ${n} notas com o mesmo tomador, valor, descrição e mês. Confirme se quer emitir outra.`;
}
