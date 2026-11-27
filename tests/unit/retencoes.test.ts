import { describe, expect, it } from "vitest";
import { calcularNota, camposFiscaisNota, lerPercentual, tipoRetPisCofins } from "@/lib/nfse/retencoes";

describe("retenções", () => {
  it("lê percentual com vírgula e recusa fora da faixa", () => {
    expect(lerPercentual("11")).toBe("11.00");
    expect(lerPercentual("0,65")).toBe("0.65");
    expect(lerPercentual("")).toBeNull();
    expect(lerPercentual(undefined)).toBeNull();
    expect(() => lerPercentual("100")).toThrow();
    expect(() => lerPercentual("1,555")).toThrow();
  });
  it("valor líquido = serviço − ISS retido − federais, half-up ao centavo", () => {
    const c = calcularNota({ valorServico: "1333.33", issRetido: true, aliquotaIss: "2.01", pct: { irrf: "1.5", pis: "0.65", cofins: "3", csll: "1" } });
    expect(c.retencoes.irrf).toBe("20.00");
    expect(c.retencoes.pis).toBe("8.67");
    expect(c.retencoes.cofins).toBe("40.00");
    expect(c.retencoes.csll).toBe("13.33");
    expect(c.valorIssRetido).toBe("26.80");
    expect(c.totalRetido).toBe("108.80");
    expect(c.valorLiquido).toBe("1224.53");
  });
  it("sem nenhuma retenção o líquido é o próprio valor", () => {
    const l = camposFiscaisNota({ valorServico: "100.00", issRetido: false, pct: {} });
    expect(l.valor_liquido).toBe("100.00");
    expect(l.valor_iss).toBeNull();
    expect(l.valor_ret_inss).toBe("0.00");
  });
  it("tpRetPisCofins cobre as combinações", () => {
    expect(tipoRetPisCofins(true, true, true)).toBe("3");
    expect(tipoRetPisCofins(true, true, false)).toBe("4");
    expect(tipoRetPisCofins(true, false, false)).toBe("5");
    expect(tipoRetPisCofins(false, true, false)).toBe("6");
    expect(tipoRetPisCofins(false, true, true)).toBe("7");
    expect(tipoRetPisCofins(false, false, true)).toBe("8");
    expect(tipoRetPisCofins(true, false, true)).toBe("9");
    expect(tipoRetPisCofins(false, false, false)).toBe("0");
  });
});
