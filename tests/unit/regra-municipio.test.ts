import { describe, expect, it } from "vitest";
import { avaliarRegraMunicipio, type SituacaoMunicipio } from "@/lib/nfse/regra-municipio";

const ipero: SituacaoMunicipio = { codIbge: "3521408", nome: "Iperó", uf: "SP", ativoOperacional: true, emissorNacional: false };
const bage: SituacaoMunicipio = { codIbge: "4301602", nome: "Bagé", uf: "RS", ativoOperacional: true, emissorNacional: true };

describe("regra de município (AT-001 a AT-003)", () => {
  it("AT-001: Simples em município com emissor próprio emite no nacional a partir de 11/2026", () => {
    expect(avaliarRegraMunicipio({ opSimpNac: 3, competencia: "2026-11-01", municipio: ipero })).toEqual({ permitido: true });
    expect(avaliarRegraMunicipio({ opSimpNac: 2, competencia: "2026-12-01", municipio: ipero })).toEqual({ permitido: true });
  });
  it("AT-002: município não ativo operacional bloqueia", () => {
    const r = avaliarRegraMunicipio({ opSimpNac: 3, competencia: "2026-11-01", municipio: { ...ipero, ativoOperacional: false } });
    expect(r).toMatchObject({ permitido: false, codigo: "MUNICIPIO_INATIVO" });
  });
  it("AT-003: competência anterior a 11/2026 em município com emissor próprio bloqueia e orienta a prefeitura", () => {
    const r = avaliarRegraMunicipio({ opSimpNac: 3, competencia: "2026-10-01", municipio: ipero });
    expect(r).toMatchObject({ permitido: false, codigo: "COMPETENCIA_RETROATIVA" });
    if (!r.permitido) expect(r.motivo).toContain("prefeitura");
  });
  it("competência anterior em município já conveniado continua permitida", () => {
    expect(avaliarRegraMunicipio({ opSimpNac: 2, competencia: "2026-10-01", municipio: bage })).toEqual({ permitido: true });
  });
  it("município desconhecido e regime fora do escopo bloqueiam", () => {
    expect(avaliarRegraMunicipio({ opSimpNac: 3, competencia: "2026-11-01", municipio: null })).toMatchObject({ codigo: "MUNICIPIO_DESCONHECIDO" });
    expect(avaliarRegraMunicipio({ opSimpNac: 1, competencia: "2026-11-01", municipio: bage })).toMatchObject({ codigo: "REGIME_FORA_DO_ESCOPO" });
  });
});
