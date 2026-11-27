import { PDFDocument } from "pdf-lib";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { faturamentoMensal, intervalo, issPorMunicipio, issRetido, percentualLimite, periodo, somarMeses } from "@/lib/relatorios/calculos";
import { nomeArquivo, relatorioPdf, relatorioXlsx, valorBR } from "@/lib/relatorios/exportar";
import type { Relatorio } from "@/lib/relatorios/tipos";

describe("competências", () => {
  it("soma meses atravessando o ano", () => {
    expect(somarMeses("2026-01", -1)).toBe("2025-12");
    expect(somarMeses("2026-11", 2)).toBe("2027-01");
    expect(somarMeses("2026-03", -12)).toBe("2025-03");
  });
  it("monta o intervalo e o texto do período", () => {
    expect(intervalo("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(intervalo("2026-02", "2025-11")).toHaveLength(4);
    expect(periodo("2026-11", "2026-11")).toBe("11/2026");
    expect(periodo("2026-01", "2026-11")).toBe("01/2026 a 11/2026");
  });
});

describe("faturamento mensal", () => {
  const notas = [
    { competencia: "2025-12-01", valor_servico: "1000.00" },
    { competencia: "2026-01-01", valor_servico: "100.10" },
    { competencia: "2026-01-01", valor_servico: 200.2 },
    { competencia: "2026-03-01", valor_servico: "4200.00", iss_retido: true, aliquota_iss: "2.00" },
    { competencia: "2026-03-01", valor_servico: null },
  ];
  const meses = faturamentoMensal(notas, "2026");
  it("soma por mês em decimal, sem erro de ponto flutuante", () => {
    expect(meses).toHaveLength(12);
    expect(meses[0]).toMatchObject({ competencia: "2026-01", notas: 2, valor: "300.30", acumuladoAno: "300.30" });
    expect(meses[1]).toMatchObject({ valor: "0.00", acumuladoAno: "300.30" });
    expect(meses[2]).toMatchObject({ notas: 1, valor: "4200.00", issRetido: "84.00", acumuladoAno: "4500.30" });
    expect(meses[11]!.acumuladoAno).toBe("4500.30");
  });
  it("RBT12 é a receita dos 12 meses anteriores, sem o próprio mês", () => {
    expect(meses[0]!.rbt12).toBe("1000.00");
    expect(meses[1]!.rbt12).toBe("1300.30");
    expect(meses[2]!.rbt12).toBe("1300.30");
    expect(meses[3]!.rbt12).toBe("5500.30");
  });
  it("percentual do limite por regime", () => {
    expect(percentualLimite("74300.00", "MEI")).toBe(91.7);
    expect(percentualLimite("360000.00", "ME")).toBe(100);
    expect(percentualLimite("1000.00", "OUTRO")).toBeNull();
  });
});

describe("ISS por município", () => {
  it("separa receita com ISS no DAS da receita com ISS retido", () => {
    const g = issPorMunicipio([
      { competencia: "2026-11-01", valor_servico: "1800.00", cod_municipio_prestacao: "4301602" },
      { competencia: "2026-11-01", valor_servico: "350.00", cod_municipio_prestacao: "4301602" },
      { competencia: "2026-11-01", valor_servico: "4200.00", iss_retido: true, aliquota_iss: "2", cod_municipio_prestacao: "4314407" },
      { competencia: "2026-11-01", valor_servico: "100.00", iss_retido: true, aliquota_iss: "5", cod_municipio_prestacao: "4314407" },
    ]);
    expect(g[0]).toMatchObject({ codigo: "4314407", notas: 2, receita: "4300.00", semRetencao: "0.00", comRetencao: "4300.00", issRetido: "89.00", aliquotas: ["2.00", "5.00"] });
    expect(g[1]).toMatchObject({ codigo: "4301602", notas: 2, receita: "2150.00", semRetencao: "2150.00", issRetido: "0.00" });
  });
  it("retenção sem alíquota não inventa ISS", () => {
    expect(issRetido({ competencia: null, valor_servico: "10", iss_retido: true, aliquota_iss: null })).toBeNull();
    expect(issRetido({ competencia: null, valor_servico: "333.33", iss_retido: true, aliquota_iss: "2.5" })).toBe("8.33");
  });
});

describe("exportação", () => {
  const r: Relatorio = {
    titulo: "Notas emitidas",
    subtitulo: "SEILA PERES DE MORAIS · competência 11/2026",
    colunas: [{ rotulo: "Nº" }, { rotulo: "Tomador" }, { rotulo: "Valor", tipo: "valor" }, { rotulo: "Situação", tipo: "selo" }],
    linhas: Array.from({ length: 90 }, (_, k) => [{ texto: String(k + 1), href: `/notas/${k}` }, "Padaria Ação & Coração → “Teste” ção", "1800.50", { selo: "autorizada", texto: "Autorizada" }]),
    total: ["Total", null, "162045.00", null],
    destaques: [{ rotulo: "Notas", valor: "90" }],
    grafico: [{ rotulo: "jan", valor: "10" }, { rotulo: "fev", valor: "0.00" }],
    observacoes: ["Canceladas não entram no total."],
    vazio: "nada",
  };
  const rodape = { geradoEm: "27/11/2026 10:14", geradoPor: "José", ambiente: "PRODUÇÃO RESTRITA" };

  it("formata valor no padrão brasileiro", () => {
    expect(valorBR("1234567.5")).toBe("1.234.567,50");
    expect(valorBR(null)).toBe("—");
  });
  it("gera PDF com várias páginas e acentos", async () => {
    const pdf = await PDFDocument.load(await relatorioPdf(r, rodape));
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(pdf.getTitle()).toContain("Notas emitidas");
  });
  it("gera PDF de relatório vazio", async () => {
    const pdf = await PDFDocument.load(await relatorioPdf({ ...r, linhas: [], total: undefined }, rodape));
    expect(pdf.getPageCount()).toBe(1);
  });
  it("gera Excel com valores numéricos e total", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await relatorioXlsx(r, rodape)) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const valores: unknown[] = [];
    ws.eachRow((row) => valores.push(row.getCell(3).value));
    expect(valores).toContain(1800.5);
    expect(valores).toContain(162045);
    expect(ws.getCell("A1").value).toBe("Notas emitidas");
  });
  it("nome de arquivo sem acento", () => {
    expect(nomeArquivo(r, "pdf")).toBe("notas-emitidas-seila-peres-de-morais-competencia-11-2026.pdf");
  });
});
