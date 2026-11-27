import { iss, lerValor, somar, subtrair, type Valor } from "@/lib/money";

/**
 * Retenções da nota (pedido do José, 27/11/2026): percentuais sobre o valor do serviço.
 * O valor de cada retenção é base × % ÷ 100, half-up na 2ª casa (AT-030), o mesmo cálculo
 * na tela, no banco e na DPS.
 */
export const TRIBUTOS_RETIDOS = ["inss", "irrf", "csll", "pis", "cofins"] as const;
export type TributoRetido = (typeof TRIBUTOS_RETIDOS)[number];
export type PercentuaisRetencao = Partial<Record<TributoRetido, string | null>>;
export type ValoresRetencao = Record<TributoRetido, Valor>;

export const ROTULO_RETENCAO: Record<TributoRetido, string> = {
  inss: "INSS",
  irrf: "IRRF",
  csll: "CSLL",
  pis: "PIS",
  cofins: "COFINS",
};

/** Percentual de exemplo mostrado na tela (não é preenchido sozinho). */
export const EXEMPLO_RETENCAO: Record<TributoRetido, string> = {
  inss: "11,00",
  irrf: "1,50",
  csll: "1,00",
  pis: "0,65",
  cofins: "3,00",
};

/** "" / null → null; senão percentual com até 2 casas, maior que 0 e menor que 100, em "1.50". */
export function lerPercentual(entrada: string | number | null | undefined): string | null {
  if (entrada === null || entrada === undefined) return null;
  const s = typeof entrada === "number" ? String(entrada) : entrada.trim().replace("%", "");
  if (s === "" || s === "0" || s === "0,00" || s === "0.00") return null;
  const v = lerValor(s);
  if (v.lessThanOrEqualTo(0) || v.greaterThanOrEqualTo(100) || v.decimalPlaces() > 2) {
    throw new Error("percentual de retenção precisa ser maior que 0, menor que 100 e ter até 2 casas");
  }
  return lerValor(s).toFixed(2);
}

export function valoresRetencao(valorServico: string, pct: PercentuaisRetencao): ValoresRetencao {
  const r = {} as ValoresRetencao;
  for (const t of TRIBUTOS_RETIDOS) r[t] = pct[t] ? iss(valorServico, pct[t]!) : "0.00";
  return r;
}

export type CalculoNota = {
  retencoes: ValoresRetencao;
  valorIssRetido: Valor | null;
  totalRetido: Valor;
  valorLiquido: Valor;
};

/** Valor líquido = serviço − ISS retido − retenções federais. Recusa líquido negativo. */
export function calcularNota(args: { valorServico: string; issRetido: boolean; aliquotaIss?: string | null; pct: PercentuaisRetencao }): CalculoNota {
  const retencoes = valoresRetencao(args.valorServico, args.pct);
  const valorIssRetido = args.issRetido && args.aliquotaIss ? iss(args.valorServico, args.aliquotaIss) : null;
  const partes = [...TRIBUTOS_RETIDOS.map((t) => retencoes[t]), valorIssRetido ?? "0"];
  const totalRetido = somar(...partes);
  const valorLiquido = subtrair(args.valorServico, ...partes);
  if (lerValor(valorLiquido).lessThan(0)) throw new Error("as retenções somam mais que o valor do serviço");
  return { retencoes, valorIssRetido, totalRetido, valorLiquido };
}

/**
 * tpRetPisCofins da DPS v1.01 a partir do que foi retido:
 * 0 nada retido · 3 PIS/COFINS/CSLL · 4 PIS/COFINS sem CSLL · 5 só PIS · 6 só COFINS ·
 * 7 COFINS/CSLL · 8 só CSLL · 9 PIS/CSLL.
 */
export function tipoRetPisCofins(pis: boolean, cofins: boolean, csll: boolean): string {
  if (pis && cofins && csll) return "3";
  if (pis && cofins) return "4";
  if (pis && csll) return "9";
  if (cofins && csll) return "7";
  if (pis) return "5";
  if (cofins) return "6";
  if (csll) return "8";
  return "0";
}

export function temRetencaoFederal(pct: PercentuaisRetencao): boolean {
  return TRIBUTOS_RETIDOS.some((t) => Boolean(pct[t]));
}

/** Colunas da nota (percentuais, valores retidos, ISS retido e líquido) a partir dos dados digitados. */
export function camposFiscaisNota(args: { valorServico: string; issRetido: boolean; aliquotaIss?: string | null; pct: PercentuaisRetencao }) {
  const c = calcularNota(args);
  const linha: Record<string, string | null> = { valor_iss: c.valorIssRetido, valor_liquido: c.valorLiquido };
  for (const t of TRIBUTOS_RETIDOS) {
    linha[`pct_ret_${t}`] = args.pct[t] ?? null;
    linha[`valor_ret_${t}`] = c.retencoes[t];
  }
  return linha;
}

/** Lê pct_ret_* de uma linha do banco (serviço ou nota). */
export function percentuaisDaLinha(l: Record<string, unknown> | null | undefined): PercentuaisRetencao {
  const r: PercentuaisRetencao = {};
  for (const t of TRIBUTOS_RETIDOS) {
    const v = l?.[`pct_ret_${t}`];
    r[t] = v === null || v === undefined || v === "" ? null : lerPercentual(String(v));
  }
  return r;
}
