/**
 * Identificador da DPS (TSIdDPS, 45 posições): "DPS" + cMun(7) + tpInsc(1) + inscrição(14) + série(5) + nDPS(15).
 * tpInsc 2 = CNPJ. Mesma fórmula de app.montar_id_dps (0008_fila.sql).
 */
export function montarIdDps(codMunicipio: string, cnpj: string, serie: string, numero: bigint | number): string {
  if (!/^\d{7}$/.test(codMunicipio)) throw new Error("código de município IBGE inválido");
  if (!/^\d{14}$/.test(cnpj)) throw new Error("CNPJ inválido");
  if (!/^\d{1,5}$/.test(serie)) throw new Error("série da DPS inválida");
  const n = BigInt(numero);
  if (n < 1n || n > 999_999_999_999_999n) throw new Error("número da DPS fora da faixa");
  return `DPS${codMunicipio}2${cnpj}${serie.padStart(5, "0")}${n.toString().padStart(15, "0")}`;
}
