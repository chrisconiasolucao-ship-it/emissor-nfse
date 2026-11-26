import { ErroTecnicoSefin } from "./erros-sefin";
import type { Transporte } from "./sefin-client";
import { gunzipB64 } from "./xml";

/**
 * Distribuição ADN (AT-021): GET /DFe/{NSU}?cnpjConsulta={cnpj}&lote=true.
 * Sem os dois parâmetros a API devolve 400 genérico. E2230 "Nenhum documento localizado" = fim normal.
 * Um NSU por CNPJ. XML vem GZip + Base64.
 */
export const FIM_DA_FILA = "E2230";

export type DocumentoAdn = { nsu: bigint; chaveAcesso: string | null; tipo: string; xml: string };
export type PaginaAdn = { documentos: DocumentoAdn[]; fim: boolean; ultimoNsu: bigint };

const obter = (o: Record<string, unknown>, nome: string): unknown => {
  const k = Object.keys(o).find((x) => x.toLowerCase() === nome.toLowerCase());
  return k ? o[k] : undefined;
};

export class AdnClient {
  constructor(
    private baseUrl: string,
    private transporte: Transporte,
    private timeoutMs = 30_000,
  ) {}

  async pagina(cnpj: string, nsu: bigint): Promise<PaginaAdn> {
    const url = `${this.baseUrl}/DFe/${nsu.toString()}?cnpjConsulta=${cnpj}&lote=true`;
    let r;
    try {
      r = await this.transporte({ metodo: "GET", url, timeoutMs: this.timeoutMs });
    } catch (e) {
      throw new ErroTecnicoSefin(e instanceof Error ? e.message : String(e));
    }
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(r.corpo.toString("utf8")) as Record<string, unknown>;
    } catch {
      /* corpo vazio */
    }
    const erros = (obter(body, "Erros") as Record<string, unknown>[] | undefined) ?? [];
    if (erros.some((e) => String(obter(e, "Codigo")) === FIM_DA_FILA)) {
      return { documentos: [], fim: true, ultimoNsu: nsu };
    }
    if (r.status >= 500 || r.status === 429 || r.status === 0) throw new ErroTecnicoSefin(`ADN indisponível (HTTP ${r.status})`, r.status);
    if (r.status >= 400) {
      const desc = erros.map((e) => `${String(obter(e, "Codigo"))}: ${String(obter(e, "Descricao"))}`).join(" | ");
      throw new ErroTecnicoSefin(`ADN recusou a consulta (HTTP ${r.status}) ${desc}`, r.status);
    }
    const lote = (obter(body, "LoteDFe") as Record<string, unknown>[] | undefined) ?? [];
    const documentos = lote.map((d) => ({
      nsu: BigInt(String(obter(d, "NSU") ?? "0")),
      chaveAcesso: (obter(d, "ChaveAcesso") as string | undefined) ?? null,
      tipo: String(obter(d, "TipoDocumento") ?? ""),
      xml: gunzipB64(String(obter(d, "ArquivoXml") ?? "")),
    }));
    const ultimoNsu = documentos.reduce((m, d) => (d.nsu > m ? d.nsu : m), nsu);
    return { documentos, fim: documentos.length === 0, ultimoNsu };
  }

  /** Percorre a fila a partir do último NSU guardado, até o fim normal (E2230). */
  async *todos(cnpj: string, desdeNsu: bigint, maxPaginas = 50): AsyncGenerator<DocumentoAdn, bigint> {
    let nsu = desdeNsu;
    for (let i = 0; i < maxPaginas; i++) {
      // documentos repetidos são inofensivos: documento e chave de acesso são únicos no banco
      const p = await this.pagina(cnpj, nsu);
      for (const d of p.documentos) yield d;
      if (p.fim || p.ultimoNsu <= nsu) return nsu;
      nsu = p.ultimoNsu;
    }
    return nsu;
  }
}
