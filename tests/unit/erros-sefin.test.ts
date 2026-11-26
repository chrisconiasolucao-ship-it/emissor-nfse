import { describe, expect, it } from "vitest";
import { classificar } from "@/lib/nfse/erros-sefin";

describe("classificação de erros da Sefin (AT-005, AT-006)", () => {
  it.each([500, 502, 503, 429, 408, undefined])("HTTP %s é técnico (nova tentativa)", (s) => {
    expect(classificar(s, {}).tipo).toBe("tecnico");
  });
  it("400 com lista de erros é dado, com a mensagem da Receita", () => {
    const c = classificar(400, { erros: [{ Codigo: "E0312", Descricao: "CPF do tomador inválido" }] });
    expect(c).toEqual({ tipo: "dado", codigo: "E0312", mensagem: "E0312: CPF do tomador inválido" });
  });
  it("junta vários erros e acrescenta orientação conhecida", () => {
    const c = classificar(400, { Erros: [{ Codigo: "E0008", Descricao: "DPS duplicada" }, { codigo: "E9", descricao: "outro", complemento: "x" }] });
    expect(c.codigo).toBe("E0008");
    expect(c.mensagem).toContain("número repetido");
    expect(c.mensagem).toContain("E9: outro (x)");
  });
  it("401/403 sem lista = certificado recusado (dado); 400 sem lista = técnico", () => {
    expect(classificar(403, {})).toMatchObject({ tipo: "dado", codigo: "HTTP_403" });
    expect(classificar(400, "")).toMatchObject({ tipo: "tecnico" });
  });
});
