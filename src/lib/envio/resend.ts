import { FalhaNoEnvio, type PedidoEmail } from "./smtp";

/** Envio pelo Resend (https://resend.com/docs/api-reference/emails/send-email), por fetch, sem SDK. */
export async function enviarPeloResend(apiKey: string, p: PedidoEmail, f: typeof fetch = fetch): Promise<string> {
  const corpo = {
    from: p.de,
    to: p.para,
    ...(p.responderPara ? { reply_to: p.responderPara } : {}),
    subject: p.assunto,
    html: p.html,
    text: p.texto,
    attachments: p.anexos.map((a) => ({ filename: a.nome, content: a.conteudo.toString("base64"), content_type: a.tipo })),
  };
  let r: Response;
  try {
    r = await f("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new FalhaNoEnvio(`Não consegui falar com o serviço de e-mail: ${(e as Error).message}`);
  }
  const j = (await r.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!r.ok || !j.id) throw new FalhaNoEnvio(traduzirResend(r.status, j.message ?? j.name ?? ""));
  return j.id;
}

/** Mensagens do Resend em português. */
export function traduzirResend(status: number, msg: string): string {
  if (/only send testing emails to your own email/i.test(msg)) {
    return "O Resend ainda está em modo de teste: só entrega para o e-mail dono da conta. Falta verificar o domínio no Resend.";
  }
  if (/domain is not verified|not verified/i.test(msg)) return "O domínio do remetente ainda não foi verificado no Resend (confira os registros DNS).";
  if (status === 401 || status === 403) return "A chave do Resend (RESEND_API_KEY) foi recusada. Confira a chave na Vercel.";
  if (status === 429) return "Limite de envios do Resend atingido. Tente de novo em alguns minutos.";
  return `O serviço de e-mail recusou o envio (HTTP ${status})${msg ? `: ${msg}` : ""}.`;
}
