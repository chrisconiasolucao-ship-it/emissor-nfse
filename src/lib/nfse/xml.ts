import { gunzipSync, gzipSync } from "node:zlib";

/** Escapa texto para XML (conteúdo e atributos). */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Elemento simples; omitido quando o valor é vazio/nulo. */
export function el(tag: string, valor: string | null | undefined): string {
  if (valor === null || valor === undefined || valor === "") return "";
  return `<${tag}>${esc(valor)}</${tag}>`;
}

export function grupo(tag: string, conteudo: string): string {
  return conteudo ? `<${tag}>${conteudo}</${tag}>` : "";
}

export const DECLARACAO_XML = '<?xml version="1.0" encoding="UTF-8"?>';

/** Põe a declaração UTF-8 no início (a Sefin rejeita com E1229 sem ela). Não mexe na assinatura: fica fora do elemento raiz. */
export function comDeclaracao(xml: string): string {
  const semBom = xml.replace(/^\uFEFF/, "");
  return /^\s*<\?xml\b/.test(semBom) ? semBom : DECLARACAO_XML + semBom;
}

/** XML → GZip → Base64, sempre com a declaração UTF-8 (formato que a Sefin Nacional pede no envio). */
export const gzipB64 = (xml: string) => gzipSync(Buffer.from(comDeclaracao(xml), "utf8")).toString("base64");
export const gunzipB64 = (b64: string) => gunzipSync(Buffer.from(b64, "base64")).toString("utf8");

/** Data/hora no fuso de Brasília (sem horário de verão desde 2019): AAAA-MM-DDThh:mm:ss-03:00. */
export function dataHoraBrasilia(d: Date): string {
  const local = new Date(d.getTime() - 3 * 3_600_000);
  return local.toISOString().slice(0, 19) + "-03:00";
}
