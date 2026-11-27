import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { lerNfse } from "@/lib/nfse/nfse-parser";
import { inserirComResumo, resumoDaNfse } from "@/lib/nfse/resumo-documento";

const m = lerNfse(readFileSync(resolve(__dirname, "../fixtures/nfse-170.xml"), "utf8"));

describe("resumo da NFS-e guardada (0015)", () => {
  it("nota em que a empresa é a prestadora: outra parte é o tomador", () => {
    expect(resumoDaNfse(m, "11222333000181")).toMatchObject({ papel: "prestada", outra_parte: "MARIA DE TESTE", outra_parte_documento: "52998224725", numero_nfse: "170", competencia: "2026-11-01", valor: "1350.00" });
  });
  it("nota em que a empresa é a tomadora: outra parte é o prestador", () => {
    const r = resumoDaNfse(m, "52998224725");
    expect(r.papel).toBe("tomada");
    expect(r.outra_parte_documento).toBe("11222333000181");
  });
  it("empresa que não aparece na nota fica sem papel", () => {
    expect(resumoDaNfse(m, "99999999000199").papel).toBeNull();
  });
  it("banco sem a migration 0015: grava de novo sem as colunas do resumo", async () => {
    const inserir = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST204", message: "coluna papel não existe" } })
      .mockResolvedValueOnce({ data: { id: "d1" }, error: null });
    const r = await inserirComResumo(inserir, { empresa_id: "e1" }, resumoDaNfse(m, "11222333000181"));
    expect(r.data).toEqual({ id: "d1" });
    expect(inserir).toHaveBeenCalledTimes(2);
    expect(inserir.mock.calls[1]![0]).toEqual({ empresa_id: "e1" });
  });
});
