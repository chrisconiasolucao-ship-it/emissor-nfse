import { describe, expect, it } from "vitest";
import { periodo, semDuplicadas } from "@/lib/notas/importadas";

describe("período da tela Notas", () => {
  it("abre no mês atual sem parâmetros", () => {
    expect(periodo({}, "2026-11")).toEqual({ de: "2026-11", ate: "2026-11" });
  });
  it("aceita várias competências (de/até) e inverte se vier trocado", () => {
    expect(periodo({ de: "2026-09", ate: "2026-11" }, "2026-11")).toEqual({ de: "2026-09", ate: "2026-11" });
    expect(periodo({ de: "2026-11", ate: "2026-01" }, "2026-11")).toEqual({ de: "2026-01", ate: "2026-11" });
  });
  it("campos limpos mostram todos os meses; só 'de' ou só 'até' fica aberto do outro lado", () => {
    expect(periodo({ de: "", ate: "" }, "2026-11")).toEqual({ de: undefined, ate: undefined });
    expect(periodo({ de: "2026-01", ate: "" }, "2026-11")).toEqual({ de: "2026-01", ate: undefined });
  });
  it("o filtro antigo de uma competência continua valendo", () => {
    expect(periodo({ competencia: "2026-10" }, "2026-11")).toEqual({ de: "2026-10", ate: "2026-10" });
  });
});

describe("importadas sem duplicar as notas do sistema", () => {
  it("tira a que já foi emitida aqui (mesmo número, mesma empresa), mesmo com zeros à esquerda", () => {
    const imp = [
      { id: "a", empresa_id: "e1", numero_nfse: "000013" },
      { id: "b", empresa_id: "e1", numero_nfse: "12" },
      { id: "c", empresa_id: "e2", numero_nfse: "13" },
      { id: "d", empresa_id: "e1", numero_nfse: null },
    ];
    const sis = [{ empresa_id: "e1", numero_nfse: "13" }, { empresa_id: "e1", numero_nfse: null }];
    expect(semDuplicadas(imp, sis).map((x) => x.id)).toEqual(["b", "c", "d"]);
  });
});
