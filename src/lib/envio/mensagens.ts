/** Textos e endereços do envio da nota ao tomador (e-mail e WhatsApp). Funções puras, testadas em tests/unit/envio.test.ts. */

export type DadosNota = {
  numero: string | null;
  empresa: string;
  tomador: string | null;
  valor: string; // já formatado, ex.: "R$ 200,00"
  competencia: string | null; // "MM/AAAA"
};

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** Até 3 destinatários separados por vírgula, ponto e vírgula ou espaço. Devolve os válidos ou o erro. */
export function lerEmails(entrada: string): { emails: string[] } | { erro: string } {
  const partes = entrada.split(/[\s,;]+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (partes.length === 0) return { erro: "Informe o e-mail do destinatário." };
  if (partes.length > 3) return { erro: "No máximo 3 e-mails por envio." };
  const ruim = partes.find((p) => !EMAIL.test(p) || p.length > 200);
  if (ruim) return { erro: `E-mail inválido: ${ruim}` };
  return { emails: [...new Set(partes)] };
}

/** Telefone brasileiro para o wa.me: só dígitos, com 55. Aceita (11) 91234-5678, 11912345678, +55 11 91234-5678. */
export function telefoneWhatsApp(entrada: string | null | undefined): string | null {
  let d = (entrada ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1); // 0 de discagem interurbana
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!/^55\d{10,11}$/.test(d)) return null;
  return d;
}

const titulo = (n: DadosNota) => `NFS-e${n.numero ? ` nº ${n.numero}` : ""}`;

export function textoWhatsApp(n: DadosNota, link: string, dias: number): string {
  const ola = n.tomador ? `Olá, ${n.tomador}!` : "Olá!";
  return [
    ola,
    `Segue a ${titulo(n)} emitida por ${n.empresa}, no valor de ${n.valor}${n.competencia ? `, competência ${n.competencia}` : ""}.`,
    `Baixe o PDF (DANFSe) e o XML neste link, válido por ${dias} dias:`,
    link,
  ].join("\n");
}

export function linkWhatsApp(telefone: string | null, texto: string): string {
  return `https://wa.me/${telefone ?? ""}?text=${encodeURIComponent(texto)}`;
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Remetente com o nome da empresa: "EMPRESA LTDA <notas@...>". Tira o que quebraria o cabeçalho. */
export function remetente(empresa: string, email: string): string {
  const nome = empresa.replace(/["<>\r\n]/g, "").trim().slice(0, 70);
  return `"${nome}" <${email}>`;
}

export function montarEmail(n: DadosNota, mensagem?: string | null): { assunto: string; html: string; texto: string } {
  const assunto = `${titulo(n)} · ${n.empresa}`;
  const extra = mensagem?.trim() ? mensagem.trim().slice(0, 1000) : null;
  const linhas = [
    n.tomador ? `Olá, ${n.tomador}.` : "Olá.",
    `Segue a ${titulo(n)} emitida por ${n.empresa}, no valor de ${n.valor}${n.competencia ? `, competência ${n.competencia}` : ""}.`,
    "O PDF (DANFSe) e o XML da nota estão em anexo.",
  ];
  const texto = [...linhas, ...(extra ? ["", extra] : []), "", `Atenciosamente,`, n.empresa].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2933;line-height:1.5">
${linhas.map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`).join("\n")}
${extra ? `<p style="margin:0 0 12px;white-space:pre-line">${esc(extra)}</p>` : ""}
<p style="margin:16px 0 0">Atenciosamente,<br>${esc(n.empresa)}</p>
</div>`;
  return { assunto, html, texto };
}
