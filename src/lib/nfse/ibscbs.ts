import { ErroCadastroDps } from "./dps-builder";
import { unico } from "./ibscbs-sugestao";

/**
 * IBS e CBS do Simples Nacional na DPS (NT 009, Anexo VI v1.04.01).
 *
 * Para o Simples, o grupo IBSCBS passa a ser obrigatório em 2027. A Sefin calcula os valores (vIBSSN, vCBSSN) pela
 * calculadora; o emitente informa o indicador da operação (cIndOp), o CST e a classificação tributária (cClassTrib).
 * O Release 4 (previsto para 24/12/2026) acrescenta regApIBSCBSSN (prestador) e cAtvSN (serviço), que o esquema da
 * restrita de 24/11/2026 ainda não aceita.
 *
 * Modos (variável NFSE_IBSCBS_SIMPLES):
 * - desligado: a DPS sai como hoje, sem nada de IBS/CBS (padrão);
 * - grupo: manda só o grupo IBSCBS (já existe no esquema atual), para testar na restrita;
 * - completo: grupo IBSCBS + regApIBSCBSSN + cAtvSN, quando o esquema do Release 4 estiver no ar.
 */
export type ModoIbsCbs = "desligado" | "grupo" | "completo";
export const MODOS_IBSCBS: readonly ModoIbsCbs[] = ["desligado", "grupo", "completo"];

/** O que vai para a DPS. regApIBSCBSSN e cAtvSN só saem no modo completo. */
export type IbsCbsDps = {
  cIndOp: string;
  cst: string;
  cClassTrib: string;
  regApIBSCBSSN: "1" | "2" | "3" | null;
  cAtvSN: string | null;
};

/** Dados lidos do banco para decidir os códigos da nota. */
export type EntradaIbsCbs = {
  opSimpNac: 2 | 3;
  /** empresa.regime_ibscbs_sn */
  regimeIbsCbsSn: 1 | 2 | 3;
  /** empresa.cativ_sn (padrão da empresa) */
  cAtvSnEmpresa?: string | null;
  /** campos do serviço cadastrado, quando a nota veio de um serviço */
  servico?: { cClassTrib?: string | null; cIndOp?: string | null; cAtvSN?: string | null } | null;
  /** correlação oficial vigente para o cTribNac + NBS da nota */
  correlacao: { indOp: string; cClassTrib: string }[];
  /** cClassTrib válidos para NFS-e → CST */
  cstDoCclasstrib: Record<string, string>;
};


/** Decide os códigos de IBS/CBS da nota. null quando desligado. Lança ErroCadastroDps quando falta escolha no cadastro. */
export function resolverIbsCbs(modo: ModoIbsCbs, e: EntradaIbsCbs | null | undefined): IbsCbsDps | null {
  if (modo === "desligado") return null;
  if (!e) throw new ErroCadastroDps("Faltam os dados de IBS/CBS da nota.");
  const validos = e.correlacao.filter((c) => e.cstDoCclasstrib[c.cClassTrib]);

  const cClassTrib = e.servico?.cClassTrib || unico(validos.map((c) => c.cClassTrib));
  if (!cClassTrib) {
    throw new ErroCadastroDps(
      validos.length
        ? "O código NBS deste serviço tem mais de uma classificação do IBS/CBS (cClassTrib). Escolha a classificação no cadastro do serviço."
        : "Informe a classificação do IBS/CBS (cClassTrib) no cadastro do serviço: a NBS da nota não tem correlação oficial.",
    );
  }
  const cst = e.cstDoCclasstrib[cClassTrib];
  if (!cst) throw new ErroCadastroDps(`A classificação ${cClassTrib} não vale para NFS-e. Corrija o cClassTrib no cadastro do serviço.`);

  const cIndOp = e.servico?.cIndOp || unico(validos.filter((c) => c.cClassTrib === cClassTrib).map((c) => c.indOp));
  if (!cIndOp) throw new ErroCadastroDps("Escolha o indicador da operação do IBS/CBS (cIndOp) no cadastro do serviço.");

  if (modo === "grupo") return { cIndOp, cst, cClassTrib, regApIBSCBSSN: null, cAtvSN: null };

  const cAtvSN = e.servico?.cAtvSN || e.cAtvSnEmpresa || null;
  if (!cAtvSN && e.opSimpNac === 3) {
    throw new ErroCadastroDps("Informe o código da atividade do Simples (cAtvSN) no serviço ou no cadastro da empresa.");
  }
  return { cIndOp, cst, cClassTrib, regApIBSCBSSN: e.opSimpNac === 3 ? (String(e.regimeIbsCbsSn) as "1" | "2" | "3") : null, cAtvSN };
}

export { sugerirIbsCbs } from "./ibscbs-sugestao";
