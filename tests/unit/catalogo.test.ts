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

describe("tabelas do IBS/CBS (base da Calculadora da Receita Federal)", () => {
  const cst = new Set(catalogo.rtcCst.map(([c]) => c));
  const cclass = new Map(catalogo.rtcCclasstrib.map(([c, s]) => [c, s]));
  it("cClassTrib da NFS-e com CST conhecido e sem repetição", () => {
    expect(catalogo.rtcCclasstrib.length).toBeGreaterThan(50);
    expect(cclass.size).toBe(catalogo.rtcCclasstrib.length);
    expect(catalogo.rtcCclasstrib.every(([c, s]) => /^\d{6}$/.test(c) && cst.has(s) && c.startsWith(s))).toBe(true);
    expect(cclass.get("000001")).toBe("000");
  });
  it("indicadores e correlação no formato; códigos de atividade do Simples da NFS-e", () => {
    const ind = new Set(catalogo.rtcIndop.map(([c]) => c));
    expect(catalogo.rtcCorrelacao.every(([i, n, o]) => /^\d{4}(\d{2})?$/.test(i) && /^\d{9}$/.test(n) && ind.has(o))).toBe(true);
    expect(catalogo.rtcAtividadeSn.map(([c]) => c)).toEqual(expect.arrayContaining(["07", "08", "09"]));
  });
  it("contabilidade (17.19) tem correlação com classificação válida para NFS-e", () => {
    const linhas = catalogo.rtcCorrelacao.filter(([i]) => itensDoCodigo("171901").includes(i));
    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas.every(([, , , c]) => cclass.has(c))).toBe(true);
  });
});
