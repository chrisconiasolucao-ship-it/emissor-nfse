import { describe, expect, it } from "vitest";
import { enviarPeloResend, traduzirResend } from "@/lib/envio/resend";
import { criarToken, eRobo, lerToken } from "@/lib/envio/link";
import { lerEmails, linkWhatsApp, montarEmail, remetente, telefoneWhatsApp, textoWhatsApp } from "@/lib/envio/mensagens";
import { enviarPorSmtp, FalhaNoEnvio, traduzir } from "@/lib/envio/smtp";

const SEGREDO = "x".repeat(40);
const ID = "3f2a1b4c-5d6e-4f70-8192-a3b4c5d6e7f8";
const NOTA = { numero: "12", empresa: "EDUARDA HAAG BERNARDI E CIA LTDA", tomador: "JOSE CARLOS", valor: "R$ 200,00", competencia: "11/2026" };

describe("link temporário do WhatsApp", () => {
  it("lê de volta o id da nota dentro da validade", () => {
    const agora = new Date("2026-11-27T12:00:00Z");
    const t = criarToken(ID, SEGREDO, agora);
    const lido = lerToken(t, SEGREDO, new Date("2026-12-03T12:00:00Z"));
    expect(lido).toMatchObject({ notaId: ID });
  });
  it("vence depois de 7 dias", () => {
    const t = criarToken(ID, SEGREDO, new Date("2026-11-27T12:00:00Z"));
    expect(lerToken(t, SEGREDO, new Date("2026-12-04T12:00:01Z"))).toEqual({ erro: "expirado" });
  });
  it("recusa token alterado ou com outro segredo", () => {
    const t = criarToken(ID, SEGREDO);
    const trocado = `${t[0] === "a" ? "b" : "a"}${t.slice(1)}`;
    expect(lerToken(trocado, SEGREDO)).toEqual({ erro: "invalido" });
    expect(lerToken(t, "y".repeat(40))).toEqual({ erro: "invalido" });
    expect(lerToken("lixo", SEGREDO)).toEqual({ erro: "invalido" });
  });
  it("não deixa estender a validade mexendo no token", () => {
    const t = criarToken(ID, SEGREDO, new Date("2026-11-27T12:00:00Z"));
    const [corpo, sig] = t.split(".");
    const outro = `${corpo!.slice(0, 32)}zzzzzz.${sig}`;
    expect(lerToken(outro, SEGREDO)).toEqual({ erro: "invalido" });
  });
});

describe("link ligado ao envio", () => {
  const ENVIO = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  it("leva o id do envio e o da nota", () => {
    const t = criarToken(ID, SEGREDO, new Date(), 7, ENVIO);
    expect(lerToken(t, SEGREDO)).toMatchObject({ notaId: ID, envioId: ENVIO });
  });
  it("link antigo, só com a nota, continua valendo", () => {
    expect(lerToken(criarToken(ID, SEGREDO), SEGREDO)).toMatchObject({ notaId: ID, envioId: null });
  });
  it("não deixa trocar o envio mantendo a assinatura", () => {
    const t = criarToken(ID, SEGREDO, new Date(), 7, ENVIO);
    const trocado = `${"f".repeat(32)}${t.slice(32)}`;
    expect(lerToken(trocado, SEGREDO)).toEqual({ erro: "invalido" });
  });
  it("prévia do WhatsApp e robôs não contam como abertura; Gmail abrindo a imagem conta", () => {
    expect(eRobo("WhatsApp/2.23.20.0 A")).toBe(true);
    expect(eRobo("facebookexternalhit/1.1")).toBe(true);
    expect(eRobo("Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36")).toBe(false);
    expect(eRobo("Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)")).toBe(false);
  });
});

describe("telefone e mensagem do WhatsApp", () => {
  it.each([
    ["(53) 99999-8888", "5553999998888"],
    ["53 9999-8888", "555399998888"],
    ["+55 53 99999-8888", "5553999998888"],
    ["053999998888", "5553999998888"],
  ])("%s vira %s", (entrada, saida) => expect(telefoneWhatsApp(entrada)).toBe(saida));
  it("recusa número sem DDD ou vazio", () => {
    expect(telefoneWhatsApp("99999-8888")).toBeNull();
    expect(telefoneWhatsApp("")).toBeNull();
    expect(telefoneWhatsApp(null)).toBeNull();
  });
  it("monta o wa.me com a mensagem e o link", () => {
    const texto = textoWhatsApp(NOTA, "https://x.app/n/abc", 7);
    expect(texto).toContain("NFS-e nº 12");
    expect(texto).toContain("R$ 200,00");
    expect(texto).toContain("https://x.app/n/abc");
    const url = linkWhatsApp("5553999998888", texto);
    expect(url.startsWith("https://wa.me/5553999998888?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1]!)).toBe(texto);
  });
});

describe("e-mail", () => {
  it("aceita até 3 e-mails e tira repetidos", () => {
    expect(lerEmails("a@b.com; A@b.com, c@d.com.br")).toEqual({ emails: ["a@b.com", "c@d.com.br"] });
    expect(lerEmails("a@b.com,b@b.com,c@b.com,d@b.com")).toHaveProperty("erro");
    expect(lerEmails("nao-e-email")).toHaveProperty("erro");
    expect(lerEmails("  ")).toHaveProperty("erro");
  });
  it("remetente leva o nome da empresa sem quebrar o cabeçalho", () => {
    expect(remetente('EMPRESA "X" <LTDA>\r\n', "escritorio@gmail.com")).toBe('"EMPRESA X LTDA" <escritorio@gmail.com>');
  });
  it("assunto e corpo com número, empresa e valor; mensagem escapada", () => {
    const e = montarEmail(NOTA, "<b>obrigado</b>");
    expect(e.assunto).toBe("NFS-e nº 12 · EDUARDA HAAG BERNARDI E CIA LTDA");
    expect(e.texto).toContain("R$ 200,00");
    expect(e.html).toContain("&lt;b&gt;obrigado&lt;/b&gt;");
    expect(e.html).not.toContain("<b>obrigado");
  });
  it("com links, traz o botão de download e a imagem de abertura", () => {
    const e = montarEmail(NOTA, null, { baixar: "https://x.app/n/tok", abertura: "https://x.app/n/tok/aberto" });
    expect(e.html).toContain('href="https://x.app/n/tok"');
    expect(e.html).toContain('<img src="https://x.app/n/tok/aberto"');
    expect(e.texto).toContain("https://x.app/n/tok");
    expect(montarEmail(NOTA).html).not.toContain("<img");
  });
  it("envia com anexos, resposta para a empresa e senha sem espaços", async () => {
    let enviado: Record<string, unknown> = {};
    let conta: Record<string, unknown> = {};
    const id = await enviarPorSmtp(
      { host: "smtp.gmail.com", porta: 465, usuario: "esc@gmail.com", senha: "abcd efgh ijkl mnop" },
      { de: "x", para: ["t@t.com"], responderPara: "emp@e.com", assunto: "s", html: "h", texto: "t", anexos: [{ nome: "a.pdf", conteudo: Buffer.from("pdf"), tipo: "application/pdf" }] },
      (c) => { conta = c; return { sendMail: async (m) => { enviado = m as Record<string, unknown>; return { messageId: "<1@x>", rejected: [] }; } }; },
    );
    expect(id).toBe("<1@x>");
    expect(conta.senha).toBe("abcd efgh ijkl mnop");
    expect(enviado.replyTo).toBe("emp@e.com");
    expect((enviado.attachments as unknown[]).length).toBe(1);
  });
  it("erro de login do Gmail vira mensagem clara", async () => {
    const falha = enviarPorSmtp({ host: "h", porta: 465, usuario: "u", senha: "s" }, { de: "x", para: ["t@t.com"], assunto: "s", html: "h", texto: "t", anexos: [] },
      () => ({ sendMail: async () => { throw Object.assign(new Error("535-5.7.8 Username and Password not accepted"), { code: "EAUTH", responseCode: 535 }); } }));
    await expect(falha).rejects.toBeInstanceOf(FalhaNoEnvio);
    await expect(falha).rejects.toThrow(/senha de app/);
    expect(traduzir({ message: "Daily user sending limit exceeded" })).toMatch(/limite diário/);
  });
});

describe("Resend (domínio próprio)", () => {
  const pedido = { de: '"EMPRESA" <notas@dominio.com.br>', para: ["t@t.com"], responderPara: "emp@e.com", assunto: "s", html: "h", texto: "t", anexos: [{ nome: "a.pdf", conteudo: Buffer.from("pdf"), tipo: "application/pdf" }] };
  it("manda remetente, resposta e anexos em base64", async () => {
    let corpo: Record<string, unknown> = {};
    let auth = "";
    const f = (async (_u: string, init: RequestInit) => {
      corpo = JSON.parse(String(init.body));
      auth = (init.headers as Record<string, string>).Authorization!;
      return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await enviarPeloResend("re_chave", pedido, f)).toBe("re_1");
    expect(auth).toBe("Bearer re_chave");
    expect(corpo.from).toBe('"EMPRESA" <notas@dominio.com.br>');
    expect(corpo.reply_to).toBe("emp@e.com");
    expect((corpo.attachments as { content: string }[])[0]!.content).toBe(Buffer.from("pdf").toString("base64"));
  });
  it("domínio não verificado vira mensagem clara", async () => {
    const f = (async () => new Response(JSON.stringify({ name: "validation_error", message: "The dominio.com.br domain is not verified." }), { status: 403 })) as unknown as typeof fetch;
    await expect(enviarPeloResend("k", pedido, f)).rejects.toThrow(/não foi verificado/);
    expect(traduzirResend(401, "")).toMatch(/RESEND_API_KEY/);
  });
});
