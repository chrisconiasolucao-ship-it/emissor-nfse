import { describe, expect, it } from "vitest";
import { catalogo, itensDoCodigo } from "@/lib/catalogo";

describe("tabelas de referência (cTribNac, NBS, correlação)", () => {
  it("códigos no formato e sem repetição", () => {
    expect(catalogo.servicos.length).toBeGreaterThan(300);
    expect(catalogo.servicos.every(([c]) => /^\d{6}$/.test(c))).toBe(true);
    expect(catalogo.nbs.every(([c]) => /^\d{9}$/.test(c))).toBe(true);
    expect(new Set(catalogo.servicos.map(([c]) => c)).size).toBe(catalogo.servicos.length);
    expect(new Set(catalogo.nbs.map(([c]) => c)).size).toBe(catalogo.nbs.length);
  });
  it("toda NBS da correlação existe na tabela NBS (a FK do banco exige)", () => {
    const nbs = new Set(catalogo.nbs.map(([c]) => c));
    expect(catalogo.correlacao.filter(([, n]) => !nbs.has(n))).toEqual([]);
  });
  it("todo item da correlação casa com algum cTribNac, exceto 990201/990301/990401 (ausentes da tabela de serviços recebida)", () => {
    const itens = new Set(catalogo.servicos.flatMap(([c]) => itensDoCodigo(c)));
    expect([...new Set(catalogo.correlacao.filter(([i]) => !itens.has(i)).map(([i]) => i))].sort()).toEqual(["990201", "990301", "990401"]);
  });
  it("contabilidade (171901) tem NBS correlacionada", () => {
    const itens = itensDoCodigo("171901");
    expect(catalogo.correlacao.some(([i]) => itens.includes(i))).toBe(true);
  });
});
