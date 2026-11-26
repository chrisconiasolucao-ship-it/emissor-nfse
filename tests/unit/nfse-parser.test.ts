import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { lerNfse } from "@/lib/nfse/nfse-parser";

describe("lerNfse (AT-019)", () => {
  it("lê a NFS-e 170 como modelo de nota", () => {
    const m = lerNfse(readFileSync(resolve(__dirname, "../fixtures/nfse-170.xml"), "utf8"));
    expect(m.chaveAcesso).toHaveLength(50);
    expect(m.numeroNfse).toBe("170");
    expect(m.competencia).toBe("2026-11-01");
    expect(m.prestadorCnpj).toBe("11222333000181");
    expect(m.tomador).toMatchObject({ tipoDocumento: "CPF", documento: "52998224725", nome: "MARIA DE TESTE" });
    expect(m.tomador?.endereco?.cep).toBe("96400000");
    expect(m.servico).toMatchObject({ codigoTributacaoNacional: "010601", codigoNbs: "113032000" });
    expect(m.valorServico).toBe("1350.00");
    expect(m.issRetido).toBe(false);
  });
  it("recusa XML que não é NFS-e", () => {
    expect(() => lerNfse("<nota><x>1</x></nota>")).toThrow();
  });
});
