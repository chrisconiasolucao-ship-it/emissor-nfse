import { describe, expect, it } from "vitest";
import { AdnClient, FIM_DA_FILA } from "@/lib/nfse/adn-client";
import { ErroTecnicoSefin } from "@/lib/nfse/erros-sefin";
import type { RespostaHttp, Transporte } from "@/lib/nfse/sefin-client";
import { gzipSync } from "node:zlib";

// o ADN devolve o XML compactado como veio; aqui sem declaração, para conferir que nada é acrescentado na leitura
const gzipB64 = (xml: string) => gzipSync(Buffer.from(xml, "utf8")).toString("base64");

const resp = (status: number, body: unknown): RespostaHttp => ({ status, corpo: Buffer.from(JSON.stringify(body)), contentType: "application/json" });

describe("AdnClient (AT-021)", () => {
  it("lê o lote, descompacta o XML e avança o NSU; E2230 encerra", async () => {
    const urls: string[] = [];
    const t: Transporte = async (req) => {
      urls.push(req.url);
      if (req.url.includes("/DFe/0?")) {
        return resp(200, { LoteDFe: [
          { NSU: 1, ChaveAcesso: "1".repeat(50), TipoDocumento: "NFSE", ArquivoXml: gzipB64("<NFSe>1</NFSe>") },
          { NSU: 2, ChaveAcesso: "2".repeat(50), TipoDocumento: "NFSE", ArquivoXml: gzipB64("<NFSe>2</NFSe>") },
        ] });
      }
      return resp(404, { Erros: [{ Codigo: FIM_DA_FILA, Descricao: "Nenhum documento localizado" }] });
    };
    const c = new AdnClient("https://adn.exemplo", t);
    const docs = [];
    for await (const d of c.todos("11222333000181", 0n)) docs.push(d);
    expect(docs.map((d) => d.xml)).toEqual(["<NFSe>1</NFSe>", "<NFSe>2</NFSe>"]);
    expect(urls[0]).toBe("https://adn.exemplo/DFe/0?cnpjConsulta=11222333000181&lote=true");
    expect(urls[1]).toContain("/DFe/2?");
  });
  it("E2220 \"Nenhum documento localizado\" (produção restrita) também é fim normal, não erro", async () => {
    const c = new AdnClient("https://adn.exemplo", async () => resp(404, { Erros: [{ Codigo: "E2220", Descricao: "Nenhum documento localizado." }] }));
    await expect(c.pagina("11222333000181", 0n)).resolves.toMatchObject({ documentos: [], fim: true, ultimoNsu: 0n });
  });
  it("outro 4xx continua sendo recusa", async () => {
    const c = new AdnClient("https://adn.exemplo", async () => resp(400, { Erros: [{ Codigo: "E9999", Descricao: "outra coisa" }] }));
    await expect(c.pagina("11222333000181", 0n)).rejects.toThrow(/E9999/);
  });
  it("5xx é falha técnica", async () => {
    const c = new AdnClient("https://adn.exemplo", async () => resp(503, {}));
    await expect(c.pagina("11222333000181", 0n)).rejects.toBeInstanceOf(ErroTecnicoSefin);
  });
});
