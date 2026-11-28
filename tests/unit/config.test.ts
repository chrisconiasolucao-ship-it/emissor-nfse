import { describe, expect, it, vi } from "vitest";
import { config } from "@/lib/config";

const base = {
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  CERT_MASTER_KEY: Buffer.alloc(32, 1).toString("base64"),
  NFSE_AMBIENTE: "producao",
  SEFIN_BASE_URL: "https://sefin.nfse.gov.br/SefinNacional",
  ADN_BASE_URL: "https://adn.nfse.gov.br/contribuintes",
  WORKER_SECRET: "s".repeat(40),
} as unknown as NodeJS.ProcessEnv;

const com = (extra: Record<string, string>) => config({ ...base, ...extra } as NodeJS.ProcessEnv);

describe("config do e-mail (28/11/2026: EMAIL_REMETENTE recusado derrubava o sistema)", () => {
  it("limpa espaço, quebra de linha e aspas coladas na Vercel", () => {
    const c = com({ EMAIL_REMETENTE: ' "notas@nfseemissornf.com.br"\n', RESEND_API_KEY: " re_abc \n" });
    expect(c.EMAIL_REMETENTE).toBe("notas@nfseemissornf.com.br");
    expect(c.RESEND_API_KEY).toBe("re_abc");
  });

  it("aceita Nome <endereço> e fica só com o endereço", () => {
    expect(com({ EMAIL_REMETENTE: "CHRISCON NFS-e <notas@nfseemissornf.com.br>" }).EMAIL_REMETENTE).toBe("notas@nfseemissornf.com.br");
  });

  it("vazio conta como não cadastrado", () => {
    const c = com({ EMAIL_REMETENTE: "  ", RESEND_API_KEY: "" });
    expect(c.EMAIL_REMETENTE).toBeUndefined();
    expect(c.RESEND_API_KEY).toBeUndefined();
  });

  it("remetente inválido fica desligado e avisa no log, sem derrubar o resto", () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = com({ EMAIL_REMETENTE: "notas arroba dominio", ENVIO_LINK_SECRET: "curto" });
    expect(c.EMAIL_REMETENTE).toBeUndefined();
    expect(c.ENVIO_LINK_SECRET).toBeUndefined();
    expect(c.WORKER_SECRET).toBe("s".repeat(40));
    expect(erro).toHaveBeenCalledWith(expect.stringContaining("EMAIL_REMETENTE inválida"));
    erro.mockRestore();
  });

  it("o que é obrigatório continua barrando", () => {
    expect(() => com({ WORKER_SECRET: "curto" })).toThrow(/WORKER_SECRET/);
  });
});
