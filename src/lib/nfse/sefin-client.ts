import https from "node:https";
import { pemsParaTls } from "../crypto/pfx";
import { classificar, ErroTecnicoSefin, lerErros, type ErroSefin } from "./erros-sefin";
import { gunzipB64, gzipB64 } from "./xml";

/**
 * Cliente da Sefin Nacional com mTLS (certificado A1 da empresa).
 * Caminhos e nomes de campo seguem a documentação pública; os Swaggers oficiais têm inconsistências,
 * então cada chamada é validada na produção restrita antes da produção (Risks do DESIGN).
 */
export const CAMINHOS = {
  emitir: "/nfse",
  consultarDps: (idDps: string) => `/dps/${encodeURIComponent(idDps)}`,
  nfse: (chave: string) => `/nfse/${encodeURIComponent(chave)}`,
  eventos: (chave: string) => `/nfse/${encodeURIComponent(chave)}/eventos`,
};

export type RespostaHttp = { status: number; corpo: Buffer; contentType: string };
export type Transporte = (req: { metodo: "GET" | "POST"; url: string; corpo?: string; timeoutMs: number }) => Promise<RespostaHttp>;

export function agenteMtls(pfx: Buffer, senha: string): https.Agent {
  // chave e cadeia já abertas pelo node-forge: o pfx direto falha no OpenSSL 3 com A1 de criptografia antiga
  const { key, cert } = pemsParaTls(pfx, senha);
  return new https.Agent({ key, cert, keepAlive: true });
}

export function transporteHttps(agent: https.Agent): Transporte {
  return ({ metodo, url, corpo, timeoutMs }) =>
    new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method: metodo,
          agent,
          headers: { accept: "application/json, application/pdf", ...(corpo ? { "content-type": "application/json" } : {}) },
          timeout: timeoutMs,
        },
        (res) => {
          const partes: Buffer[] = [];
          res.on("data", (c: Buffer) => partes.push(c));
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes), contentType: String(res.headers["content-type"] ?? "") }),
          );
        },
      );
      req.on("timeout", () => req.destroy(new Error(`timeout de ${timeoutMs} ms`)));
      req.on("error", reject);
      if (corpo) req.write(corpo);
      req.end();
    });
}

/** Começo do corpo da resposta (sem quebras), para log e diagnóstico. */
export function trecho(r: RespostaHttp, max = 600): string {
  return r.corpo.toString("utf8").replace(/\s+/g, " ").trim().slice(0, max);
}

function json(r: RespostaHttp): Record<string, unknown> {
  try {
    return JSON.parse(r.corpo.toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const campo = (o: Record<string, unknown>, ...nomes: string[]) => {
  for (const n of nomes) {
    const k = Object.keys(o).find((x) => x.toLowerCase() === n.toLowerCase());
    if (k && o[k] != null) return String(o[k]);
  }
  return undefined;
};

export type ResultadoEmissao =
  | { tipo: "autorizada"; chaveAcesso: string; nfseXml: string; alertas: ErroSefin[] }
  | { tipo: "rejeitada"; codigo: string; mensagem: string };

export type ResultadoEvento =
  | { tipo: "registrado"; eventoXml: string }
  | { tipo: "rejeitado"; codigo: string; mensagem: string };

export class SefinClient {
  constructor(
    private baseUrl: string,
    private transporte: Transporte,
    private timeoutMs = 30_000,
  ) {}

  private async chamar(metodo: "GET" | "POST", caminho: string, corpo?: object): Promise<RespostaHttp> {
    try {
      return await this.transporte({ metodo, url: this.baseUrl + caminho, corpo: corpo ? JSON.stringify(corpo) : undefined, timeoutMs: this.timeoutMs });
    } catch (e) {
      throw new ErroTecnicoSefin(e instanceof Error ? e.message : String(e));
    }
  }

  private falhaTecnica(r: RespostaHttp): never {
    const c = classificar(r.status, json(r));
    throw new ErroTecnicoSefin(`${c.mensagem} (${c.codigo})`, r.status, trecho(r));
  }

  /** Manutenção: chamada crua (status e corpo), para diagnosticar respostas inesperadas da Sefin. */
  async diagnosticar(metodo: "GET" | "POST", caminho: string, corpo?: object): Promise<{ status: number; contentType: string; corpo: string }> {
    const r = await this.chamar(metodo, caminho, corpo);
    return { status: r.status, contentType: r.contentType, corpo: r.corpo.toString("utf8").slice(0, 4000) };
  }

  /** Envia a DPS assinada. Falha técnica lança ErroTecnicoSefin; rejeição volta como resultado. */
  async emitir(dpsAssinada: string): Promise<ResultadoEmissao> {
    const r = await this.chamar("POST", CAMINHOS.emitir, { dpsXmlGZipB64: gzipB64(dpsAssinada) });
    const body = json(r);
    if (r.status >= 200 && r.status < 300) {
      const chave = campo(body, "chaveAcesso");
      const xmlB64 = campo(body, "nfseXmlGZipB64");
      if (!chave || !xmlB64) throw new ErroTecnicoSefin("resposta de autorização sem chave ou XML", r.status);
      return { tipo: "autorizada", chaveAcesso: chave, nfseXml: gunzipB64(xmlB64), alertas: lerErros({ erros: body.alertas ?? body.Alertas }) };
    }
    const c = classificar(r.status, body);
    if (c.tipo === "tecnico") this.falhaTecnica(r);
    return { tipo: "rejeitada", codigo: c.codigo, mensagem: c.mensagem };
  }

  /** Decision 4: antes de reenviar, pergunta se a DPS já virou NFS-e. Devolve a chave ou null. */
  async consultarDps(idDps: string): Promise<string | null> {
    const r = await this.chamar("GET", CAMINHOS.consultarDps(idDps));
    if (r.status === 404) return null;
    if (r.status >= 200 && r.status < 300) return campo(json(r), "chaveAcesso") ?? null;
    const c = classificar(r.status, json(r));
    if (c.tipo === "dado") return null; // "DPS não encontrada" vem como erro de negócio
    this.falhaTecnica(r);
  }

  async baixarNfse(chave: string): Promise<string> {
    const r = await this.chamar("GET", CAMINHOS.nfse(chave));
    if (r.status < 200 || r.status >= 300) this.falhaTecnica(r);
    const b64 = campo(json(r), "nfseXmlGZipB64");
    if (!b64) throw new ErroTecnicoSefin("resposta sem XML da NFS-e", r.status);
    return gunzipB64(b64);
  }

  async registrarEvento(chave: string, pedidoAssinado: string): Promise<ResultadoEvento> {
    const r = await this.chamar("POST", CAMINHOS.eventos(chave), { pedidoRegistroEventoXmlGZipB64: gzipB64(pedidoAssinado) });
    const body = json(r);
    if (r.status >= 200 && r.status < 300) {
      const b64 = campo(body, "eventoXmlGZipB64");
      if (!b64) throw new ErroTecnicoSefin("resposta de evento sem XML", r.status);
      return { tipo: "registrado", eventoXml: gunzipB64(b64) };
    }
    const c = classificar(r.status, body);
    if (c.tipo === "tecnico") this.falhaTecnica(r);
    return { tipo: "rejeitado", codigo: c.codigo, mensagem: c.mensagem };
  }
}
