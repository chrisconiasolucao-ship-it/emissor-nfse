import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Link temporário para o tomador baixar o DANFSe e o XML sem login (envio por WhatsApp).
 * O token leva só o id da nota e a validade, assinados com HMAC-SHA256; nada fica guardado no banco.
 * Formato: <uuid sem hífens (32 hex)><validade em segundos, base 36>.<assinatura base64url, 22 caracteres>
 */
export const DIAS_LINK = 7;

const assinar = (corpo: string, segredo: string) => createHmac("sha256", segredo).update(`envio-nota:${corpo}`).digest("base64url").slice(0, 22);

export function criarToken(notaId: string, segredo: string, agora = new Date(), dias = DIAS_LINK): string {
  const hex = notaId.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error("id de nota inválido");
  const validade = Math.floor(agora.getTime() / 1000) + dias * 86_400;
  const corpo = `${hex}${validade.toString(36)}`;
  return `${corpo}.${assinar(corpo, segredo)}`;
}

export type TokenLido = { notaId: string; validoAte: Date } | { erro: "invalido" | "expirado" };

export function lerToken(token: string, segredo: string, agora = new Date()): TokenLido {
  const m = /^([0-9a-f]{32})([0-9a-z]{1,10})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!m) return { erro: "invalido" };
  const [, hex, val, sig] = m;
  const esperado = Buffer.from(assinar(`${hex}${val}`, segredo));
  const recebido = Buffer.from(sig!);
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return { erro: "invalido" };
  const validoAte = new Date(Number.parseInt(val!, 36) * 1000);
  if (validoAte.getTime() < agora.getTime()) return { erro: "expirado" };
  const notaId = `${hex!.slice(0, 8)}-${hex!.slice(8, 12)}-${hex!.slice(12, 16)}-${hex!.slice(16, 20)}-${hex!.slice(20)}`;
  return { notaId, validoAte };
}
