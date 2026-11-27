import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Link temporário para o tomador baixar o DANFSe e o XML sem login (WhatsApp e botão do e-mail).
 * O token leva o id do envio (para saber de qual envio veio o acesso), o id da nota e a validade,
 * assinados com HMAC-SHA256; nada fica guardado no banco.
 * Formato: <envio 32 hex><nota 32 hex><validade em segundos, base 36>.<assinatura base64url, 22 caracteres>
 * Aceita também o formato antigo, só com a nota (<nota 32 hex><validade>.<assinatura>).
 */
export const DIAS_LINK = 7;

const assinar = (corpo: string, segredo: string) => createHmac("sha256", segredo).update(`envio-nota:${corpo}`).digest("base64url").slice(0, 22);
const hex = (id: string) => {
  const h = id.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) throw new Error("id inválido");
  return h;
};
const uuid = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

export function criarToken(notaId: string, segredo: string, agora = new Date(), dias = DIAS_LINK, envioId?: string): string {
  const validade = Math.floor(agora.getTime() / 1000) + dias * 86_400;
  const corpo = `${envioId ? hex(envioId) : ""}${hex(notaId)}${validade.toString(36)}`;
  return `${corpo}.${assinar(corpo, segredo)}`;
}

export type TokenLido = { notaId: string; envioId: string | null; validoAte: Date } | { erro: "invalido" | "expirado" };

export function lerToken(token: string, segredo: string, agora = new Date()): TokenLido {
  const m = /^((?:[0-9a-f]{32}){1,2})([0-9a-z]{1,10})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!m) return { erro: "invalido" };
  const [, ids, val, sig] = m;
  const esperado = Buffer.from(assinar(`${ids}${val}`, segredo));
  const recebido = Buffer.from(sig!);
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return { erro: "invalido" };
  const validoAte = new Date(Number.parseInt(val!, 36) * 1000);
  if (validoAte.getTime() < agora.getTime()) return { erro: "expirado" };
  const envio = ids!.length === 64 ? ids!.slice(0, 32) : null;
  return { notaId: uuid(ids!.slice(-32)), envioId: envio ? uuid(envio) : null, validoAte };
}

/**
 * Robôs que abrem o link sozinhos para montar a prévia (WhatsApp, Facebook, Telegram, antivírus de e-mail...).
 * Esses acessos não contam como "o tomador abriu". O GoogleImageProxy não entra aqui: é ele que carrega a
 * imagem de abertura quando a pessoa abre o e-mail no Gmail.
 */
export function eRobo(navegador: string | null | undefined): boolean {
  return /WhatsApp|facebookexternalhit|Facebot|TelegramBot|Twitterbot|Slackbot|Discordbot|LinkedInBot|SkypeUriPreview|bot\b|crawler|spider|preview|curl|python-requests|Go-http-client/i.test(navegador ?? "");
}
