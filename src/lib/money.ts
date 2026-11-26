import Decimal from "decimal.js";

/**
 * Decision 10 / AT-030: todo valor monetário trafega como string decimal com ponto,
 * é calculado em decimal.js e arredondado com ROUND_HALF_UP na 2ª casa.
 * Nunca usar number para valor de nota.
 */
const D = Decimal.clone({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export type Valor = string; // sempre "1234.56"

const formatoEntrada = /^-?\d+([.,]\d+)?$/;

/** Converte entrada humana ("1.234,56", "1234,5", "1234.56") em Decimal, sem passar por number. */
export function lerValor(entrada: string | number | Decimal): Decimal {
  if (entrada instanceof Decimal || Decimal.isDecimal(entrada)) return new D(entrada as Decimal);
  if (typeof entrada === "number") {
    // Planilhas entregam number; usamos a representação em texto mais curta, não o binário.
    if (!Number.isFinite(entrada)) throw new Error("valor inválido");
    return new D(entrada.toString());
  }
  let s = entrada.trim().replace(/\s|R\$/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  if (!formatoEntrada.test(s)) throw new Error(`valor inválido: ${entrada}`);
  return new D(s);
}

export function dinheiro(v: string | number | Decimal): Valor {
  return lerValor(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

export function somar(...vs: (string | Decimal)[]): Valor {
  return vs.reduce<Decimal>((acc, v) => acc.plus(lerValor(v)), new D(0)).toDecimalPlaces(2).toFixed(2);
}

export function subtrair(a: string, ...bs: string[]): Valor {
  return bs.reduce<Decimal>((acc, b) => acc.minus(lerValor(b)), lerValor(a)).toDecimalPlaces(2).toFixed(2);
}

/** ISS = base × alíquota% ÷ 100, arredondado half-up na 2ª casa. */
export function iss(base: string, aliquotaPct: string): Valor {
  return lerValor(base).mul(lerValor(aliquotaPct)).div(100).toDecimalPlaces(2).toFixed(2);
}

export function iguais(a: string, b: string): boolean {
  return lerValor(a).equals(lerValor(b));
}

export function positivo(v: string): boolean {
  return lerValor(v).greaterThan(0);
}
