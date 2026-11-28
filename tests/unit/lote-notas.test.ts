import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { montarLote, nomeDoZip, resumoCsv, tipoLote, type ImportadaGuardada, type NotaSistema } from "@/lib/notas/lote";
import { crc32, EscritorZip } from "@/lib/zip/zip";

/** Lê o ZIP pelo diretório central e devolve nome → conteúdo (confere o CRC de cada um). */
function lerZip(buf: Buffer): Map<string, Buffer> {
  const fim = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const saida = new Map<string, Buffer>();
  for (let i = 0; i < total; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const metodo = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const comp = buf.readUInt32LE(p + 20);
    const n = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.subarray(p + 46, p + 46 + n).toString("utf8");
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const bruto = buf.subarray(ini, ini + comp);
    const dados = metodo === 8 ? inflateRawSync(bruto) : Buffer.from(bruto);
    expect(crc32(dados)).toBe(crc);
    saida.set(nome, dados);
    p += 46 + n;
  }
  return saida;
}

describe("ZIP", () => {
  it("crc32 confere com o valor conhecido", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("gera um ZIP legível, com acento no nome e sem sobrescrever nome repetido", () => {
    const z = new EscritorZip();
    const xml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><NFSe>${"<x>São Paulo</x>".repeat(50)}</NFSe>`);
    const partes = [z.adicionar("prestadas/NFSe-1.xml", xml), z.adicionar("prestadas/NFSe-1.xml", Buffer.from("b")), z.adicionar("tomadas/Ação.txt", Buffer.from("")), z.finalizar()];
    const arq = lerZip(Buffer.concat(partes));
    expect([...arq.keys()]).toEqual(["prestadas/NFSe-1.xml", "prestadas/NFSe-1 (2).xml", "tomadas/Ação.txt"]);
    expect(arq.get("prestadas/NFSe-1.xml")!.equals(xml)).toBe(true);
    expect(arq.get("prestadas/NFSe-1 (2).xml")!.toString()).toBe("b");
  });
});

const guardado = (id: string) => ({ id, storage_path: `e/${id}`, sha256: "a".repeat(64) });
const nota = (o: Partial<NotaSistema>): NotaSistema => ({
  id: "n1", empresa_id: "E", situacao: "autorizada", numero_nfse: "10", competencia: "2026-10-01", valor_servico: "100.00",
  documento_id: "x1", danfse_documento_id: "p1", tomador: { nome: "Cliente A", documento: "12345678000199" }, ...o,
});
const imp = (o: Partial<ImportadaGuardada>): ImportadaGuardada => ({
  id: "d1", empresa_id: "E", papel: "tomada", outra_parte: "Fornecedor", outra_parte_documento: "11222333000144", numero_nfse: "10",
  competencia: "2026-10-01", valor: "50.5", nome_original: null, storage_path: "e/d1", sha256: "b".repeat(64), ...o,
});

describe("montarLote", () => {
  const base = {
    notas: [nota({}), nota({ id: "n2", situacao: "cancelada", numero_nfse: "11", documento_id: "x2", danfse_documento_id: "p2" }), nota({ id: "n3", situacao: "rejeitada", numero_nfse: null, documento_id: null })],
    docsDasNotas: ["x1", "p1", "x2", "p2"].map(guardado),
    eventos: [{ ...guardado("ev2"), nota_id: "n2" }],
    importadas: [
      imp({}), // tomada nº 10 de outro prestador: não é a nossa nº 10
      imp({ id: "d2", papel: "prestada", numero_nfse: "0010", outra_parte_documento: "12345678000199" }), // volta da nossa nº 10 pelo ADN
      imp({ id: "d3", papel: "prestada", numero_nfse: "77", outra_parte: "Cliente B" }),
    ],
    numerosDoSistema: [{ empresa_id: "E", numero_nfse: "10" }, { empresa_id: "E", numero_nfse: "11" }],
  };

  it("ambas: XML das emitidas (sem rejeitada), evento do cancelamento, importadas sem repetir e tomada mantida", () => {
    const { arquivos, resumo } = montarLote({ tipo: "ambas", pdf: false, ...base });
    expect(arquivos.map((a) => a.caminho)).toEqual([
      "prestadas/NFSe-10-12345678000199.xml",
      "prestadas/NFSe-11-12345678000199.xml",
      "prestadas/eventos/NFSe-11-12345678000199-evento.xml",
      "prestadas/NFSe-77-11222333000144.xml",
      "tomadas/NFSe-10-11222333000144.xml",
    ]);
    expect(resumo.map((r) => `${r.tipo}:${r.situacao}:${r.numero}`)).toEqual(["Prestada:Autorizada:10", "Prestada:Cancelada:11", "Prestada:Importada:77", "Tomada:Importada:10"]);
  });

  it("só tomadas e só prestadas", () => {
    expect(montarLote({ tipo: "tomadas", pdf: false, ...base }).arquivos.map((a) => a.caminho)).toEqual(["tomadas/NFSe-10-11222333000144.xml"]);
    expect(montarLote({ tipo: "prestadas", pdf: false, ...base }).resumo.every((r) => r.tipo === "Prestada")).toBe(true);
  });

  it("com PDF: usa o DANFSe guardado da autorizada e gera de novo para cancelada e importada", () => {
    const { arquivos } = montarLote({ tipo: "ambas", pdf: true, ...base });
    const pdfs = arquivos.filter((a) => a.caminho.endsWith(".pdf"));
    expect(pdfs.map((a) => [a.caminho, a.doc.id, Boolean(a.gerarPdf), a.situacao ?? ""])).toEqual([
      ["prestadas/PDF/NFSe-10-12345678000199.pdf", "p1", false, ""],
      ["prestadas/PDF/NFSe-11-12345678000199.pdf", "x2", true, "cancelada"],
      ["prestadas/PDF/NFSe-77-11222333000144.pdf", "d3", true, ""],
      ["tomadas/PDF/NFSe-10-11222333000144.pdf", "d1", true, ""],
    ]);
  });

  it("mesmo número e mesma outra parte na mesma pasta não se sobrescrevem", () => {
    const { arquivos } = montarLote({ tipo: "tomadas", pdf: false, ...base, importadas: [imp({}), imp({ id: "d9" })] });
    expect(arquivos.map((a) => a.caminho)).toEqual(["tomadas/NFSe-10-11222333000144.xml", "tomadas/NFSe-10-11222333000144-2.xml"]);
  });
});

describe("resumo e nomes", () => {
  it("CSV com ponto e vírgula, vírgula decimal e aspas quando precisa", () => {
    const { resumo } = montarLote({ tipo: "tomadas", pdf: false, notas: [], docsDasNotas: [], eventos: [], numerosDoSistema: [], importadas: [imp({ outra_parte: 'Silva; "Filhos"' })] });
    const csv = resumoCsv(resumo);
    expect(csv.startsWith("﻿Tipo;Origem;")).toBe(true);
    expect(csv).toContain('Tomada;Importada;Importada;10;10/2026;11222333000144;"Silva; ""Filhos""";50,50;tomadas/NFSe-10-11222333000144.xml');
  });

  it("tipo e nome do ZIP", () => {
    expect(tipoLote("tomadas")).toBe("tomadas");
    expect(tipoLote("x")).toBe("ambas");
    expect(nomeDoZip("12.345.678/0001-99", "2026-10", "2026-11", "ambas")).toBe("NFSe-12345678000199-2026-10-a-2026-11-ambas.zip");
    expect(nomeDoZip("12345678000199", "2026-10", "2026-10", "prestadas")).toBe("NFSe-12345678000199-2026-10-prestadas.zip");
    expect(nomeDoZip("12345678000199", undefined, undefined)).toBe("NFSe-12345678000199-todos-os-meses-ambas.zip");
  });
});
