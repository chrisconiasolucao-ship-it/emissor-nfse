/**
 * Regra de município (Key Decision 2 do brainstorm; Res. CGSN 191/2026; AT-001 a AT-003).
 * - Simples (opSimpNac 2 ou 3) com competência ≥ 2026-11-01 emite no Emissor Nacional mesmo que o
 *   município tenha "Emissor Nacional = Não".
 * - O município precisa estar "Ativo operacional" no painel da RFB.
 * - Competência anterior a 2026-11-01 em município com emissor próprio: bloquear e orientar a prefeitura.
 */
export const INICIO_OBRIGATORIEDADE_SIMPLES = "2026-11-01";

export type SituacaoMunicipio = {
  codIbge: string;
  nome: string;
  uf: string;
  ativoOperacional: boolean;
  emissorNacional: boolean;
};

export type ResultadoRegra =
  | { permitido: true }
  | { permitido: false; codigo: "MUNICIPIO_DESCONHECIDO" | "MUNICIPIO_INATIVO" | "COMPETENCIA_RETROATIVA" | "REGIME_FORA_DO_ESCOPO"; motivo: string };

export function avaliarRegraMunicipio(args: {
  opSimpNac: number;
  competencia: string; // AAAA-MM-01
  municipio: SituacaoMunicipio | null;
}): ResultadoRegra {
  const { opSimpNac, competencia, municipio } = args;
  if (opSimpNac !== 2 && opSimpNac !== 3) {
    return { permitido: false, codigo: "REGIME_FORA_DO_ESCOPO", motivo: "A 1ª versão emite só para Simples Nacional (ME/EPP) e MEI." };
  }
  if (!municipio) {
    return {
      permitido: false,
      codigo: "MUNICIPIO_DESCONHECIDO",
      motivo: "Município do prestador não está na tabela de situação dos municípios. Importe o painel da Receita.",
    };
  }
  const nome = `${municipio.nome} (${municipio.uf})`;
  if (!municipio.ativoOperacional) {
    return {
      permitido: false,
      codigo: "MUNICIPIO_INATIVO",
      motivo: `${nome} não está "Ativo operacional" no Emissor Nacional. A nota não foi enviada.`,
    };
  }
  const retroativa = competencia < INICIO_OBRIGATORIEDADE_SIMPLES;
  if (retroativa && !municipio.emissorNacional) {
    return {
      permitido: false,
      codigo: "COMPETENCIA_RETROATIVA",
      motivo: `${nome} tem emissor próprio e a competência ${competencia.slice(0, 7)} é anterior a 11/2026: emita no sistema da prefeitura.`,
    };
  }
  return { permitido: true };
}
