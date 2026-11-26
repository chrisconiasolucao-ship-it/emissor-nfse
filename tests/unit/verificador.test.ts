import { describe, expect, it } from "vitest";
import { compararComAncoras, descreverQuebra, verificarCadeia } from "@/lib/auditoria/verificador";

const h = (c: string) => c.repeat(64);

describe("verificador da cadeia (AT-034)", () => {
  it("íntegra quando o banco não acha quebra e as âncoras batem", () => {
    const r = compararComAncoras({ primeiraQuebra: null, ultimoId: 10, ultimoHash: h("a") }, [{ dia: "2026-11-25", ultimoId: 7, hash: h("7") }], new Map([[7, h("7")]]));
    expect(r.integra).toBe(true);
  });
  it("aponta a linha alterada que o banco detectou", () => {
    const r = compararComAncoras({ primeiraQuebra: 4, ultimoId: 10, ultimoHash: h("a") }, [], new Map());
    expect(r.integra).toBe(false);
    expect(r.quebras[0]).toEqual({ tipo: "hash_recalculado_nao_confere", linha: 4 });
    expect(descreverQuebra(r.quebras[0]!)).toContain("linha 4");
  });
  it("cadeia reescrita por inteiro (hashes recalculados) diverge da âncora de fora", () => {
    const r = compararComAncoras({ primeiraQuebra: null, ultimoId: 10, ultimoHash: h("b") }, [{ dia: "2026-11-25", ultimoId: 7, hash: h("7") }], new Map([[7, h("x")]]));
    expect(r.integra).toBe(false);
    expect(r.quebras[0]).toMatchObject({ tipo: "ancora_diverge", linha: 7, dia: "2026-11-25" });
  });
  it("linha ancorada removida também acusa", () => {
    const r = compararComAncoras({ primeiraQuebra: null, ultimoId: 6, ultimoHash: h("b") }, [{ dia: "2026-11-25", ultimoId: 7, hash: h("7") }], new Map());
    expect(r.quebras[0]).toMatchObject({ tipo: "ancora_diverge", encontrado: null });
    expect(descreverQuebra(r.quebras[0]!)).toContain("removida");
  });
  it("lê o resultado do banco e as linhas ancoradas", async () => {
    const db = {
      rpc: async () => ({ data: [{ primeira_quebra: null, ultimo_id: 9, ultimo_hash: h("9") }], error: null }),
      from: () => ({ select: () => ({ in: async () => ({ data: [{ id: 7, hash: h("7") }], error: null }) }) }),
    };
    const r = await verificarCadeia(db, [{ dia: "2026-11-25", ultimoId: 7, hash: h("7") }]);
    expect(r).toMatchObject({ integra: true, ultimoId: 9 });
  });
});
