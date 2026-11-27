import { createTransport, type SendMailOptions } from "nodemailer";

/** Envio por SMTP (Gmail do escritório com senha de app do Google). */

export type Anexo = { nome: string; conteudo: Buffer; tipo: string };
export type PedidoEmail = { de: string; para: string[]; responderPara?: string | null; assunto: string; html: string; texto: string; anexos: Anexo[] };
export type ContaSmtp = { host: string; porta: number; usuario: string; senha: string };

export class FalhaNoEnvio extends Error {}

type Transporte = { sendMail: (m: SendMailOptions) => Promise<{ messageId?: string; rejected?: unknown[] }> };

export async function enviarPorSmtp(conta: ContaSmtp, p: PedidoEmail, criar: (c: ContaSmtp) => Transporte = transporte): Promise<string> {
  try {
    const r = await criar(conta).sendMail({
      from: p.de,
      to: p.para,
      replyTo: p.responderPara ?? undefined,
      subject: p.assunto,
      html: p.html,
      text: p.texto,
      attachments: p.anexos.map((a) => ({ filename: a.nome, content: a.conteudo, contentType: a.tipo })),
    });
    if (r.rejected && r.rejected.length > 0) throw new FalhaNoEnvio(`O servidor de e-mail recusou: ${r.rejected.join(", ")}`);
    return r.messageId ?? "";
  } catch (e) {
    if (e instanceof FalhaNoEnvio) throw e;
    throw new FalhaNoEnvio(traduzir(e as Error & { code?: string; responseCode?: number }));
  }
}

function transporte(c: ContaSmtp): Transporte {
  return createTransport({
    host: c.host,
    port: c.porta,
    secure: c.porta === 465,
    auth: { user: c.usuario, pass: c.senha.replace(/\s/g, "") }, // o Google mostra a senha de app em 4 blocos com espaço
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
}

/** Erros do Gmail que o José vai ver, em português. */
export function traduzir(e: { message: string; code?: string; responseCode?: number }): string {
  const m = e.message ?? "";
  if (e.code === "EAUTH" || e.responseCode === 535 || /Username and Password not accepted|BadCredentials/i.test(m)) {
    return "O Gmail recusou o login. Confira o SMTP_USUARIO e a senha de app (16 letras) na Vercel; a senha normal da conta não serve.";
  }
  if (/Daily user sending limit|limit exceeded|5\.4\.5/i.test(m)) return "O Gmail atingiu o limite diário de envios (cerca de 500). Tente amanhã.";
  if (e.code === "ETIMEDOUT" || e.code === "ECONNECTION" || e.code === "ESOCKET") return "Não consegui conectar ao servidor do Gmail. Tente de novo em instantes.";
  if (e.responseCode === 550 || e.responseCode === 553) return `O destinatário foi recusado pelo servidor de e-mail: ${m}`;
  return `O e-mail não foi enviado: ${m}`;
}
