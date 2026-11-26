import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dataHora, gerarDanfse, moeda } from "@/lib/nfse/danfse";

const xml = readFileSync(resolve(__dirname, "../fixtures/nfse-170.xml"), "utf8");
const nomes: Record<string, string> = { "4301602": "Bagé / RS" };

function textoDoPdf(pdf: Buffer): string {
  const arq = join(mkdtempSync(join(tmpdir(), "danfse-")), "d.pdf");
  writeFileSync(arq, pdf);
  return execFileSync("pdftotext", ["-layout", arq, "-"]).toString();
}

describe("DANFSe gerado no sistema (NT 008)", () => {
  it("gera uma página com cabeçalho, chave, tarja de homologação e valores", async () => {
    const pdf = await gerarDanfse(xml, { nomeMunicipio: (c) => nomes[c] ?? null });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const t = textoDoPdf(pdf);
    expect(t).toContain("DANFSe v2.0");
    expect(t).toContain("Documento Auxiliar da NFS-e");
    expect(t).toContain("NFS-e SEM VALIDADE JURÍDICA");
    expect(t).toContain("43016022112223330001810000000000000170260000000001");
    expect(t).toContain("11.222.333/0001-81");
    expect(t).toContain("R$ 1.350,00");
    expect(t).toContain("Totais Aproximados dos Tributos");
    expect(t.match(/\f/g)?.length ?? 1).toBeLessThanOrEqual(1);
  });
  it("nota cancelada leva a marca CANCELADA", async () => {
    // texto girado em 45° não sai no pdftotext; confere-se que o desenho a mais está no PDF
    const normal = await gerarDanfse(xml);
    const cancelada = await gerarDanfse(xml, { situacao: "cancelada" });
    expect(cancelada.length).toBeGreaterThan(normal.length);
  });
  it("formata moeda e data como na NT", () => {
    expect(moeda("1350.5")).toBe("R$ 1.350,50");
    expect(moeda(null)).toBe("-");
    expect(dataHora("2026-11-26T15:30:07-03:00")).toBe("26/11/2026 15:30:07");
  });
  it("recusa XML que não é NFS-e", async () => {
    await expect(gerarDanfse("<a/>")).rejects.toThrow(/não é uma NFS-e/);
  });
});
