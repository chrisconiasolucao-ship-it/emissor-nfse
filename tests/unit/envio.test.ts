import { describe, expect, it } from "vitest";
import { criarToken, lerToken } from "@/lib/envio/link";
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
