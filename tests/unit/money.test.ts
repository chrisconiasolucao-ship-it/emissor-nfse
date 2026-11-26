import { describe, expect, it } from "vitest";
import { dinheiro, iguais, iss, lerValor, reais, somar, subtrair } from "@/lib/money";

describe("money (AT-030)", () => {
  it("0,10 + 0,20 fecha em 0,30", () => {
    expect(somar("0.10", "0.20")).toBe("0.30");
    expect(somar("0,10", "0,20")).toBe("0.30");
  });

  it("arredonda half-up na 2ª casa", () => {
    expect(dinheiro("2.345")).toBe("2.35");
    expect(dinheiro("2.344")).toBe("2.34");
    expect(dinheiro("-2.345")).toBe("-2.35");
  });

  it("ISS com dízima fecha ao centavo", () => {
    // 100,00 × 3,3333% = 3,3333 → 3,33
    expect(iss("100.00", "3.3333")).toBe("3.33");
    // 1.350,00 × 2,01% = 27,135 → 27,14 (half-up)
    expect(iss("1350.00", "2.01")).toBe("27.14");
  });

  it("base − ISS = líquido sem resto", () => {
    const base = "1350.00";
    const v = iss(base, "2.01");
    expect(subtrair(base, v)).toBe("1322.86");
    expect(somar(subtrair(base, v), v)).toBe(base);
  });

  it("aceita formatos brasileiros", () => {
    expect(dinheiro("1.234,56")).toBe("1234.56");
    expect(dinheiro("R$ 3.000,00")).toBe("3000.00");
    expect(dinheiro(1350)).toBe("1350.00");
    expect(dinheiro(0.1 + 0.2)).toBe("0.30");
  });

  it("recusa texto que não é número", () => {
    expect(() => lerValor("abc")).toThrow();
    expect(() => lerValor("1,2,3")).toThrow();
  });

  it("comparação exata para duplicidade", () => {
    expect(iguais("100", "100.00")).toBe(true);
    expect(iguais("100.00", "100.01")).toBe(false);
  });
});

describe("reais (tela)", () => {
  it("aceita número do banco (numeric) e texto, com milhar e 2 casas", () => {
    expect(reais(10)).toBe("R$ 10,00");
    expect(reais(1350.5)).toBe("R$ 1.350,50");
    expect(reais("1234567.89")).toBe("R$ 1.234.567,89");
    expect(reais(null)).toBe("—");
  });
});
