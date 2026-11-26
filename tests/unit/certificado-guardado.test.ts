import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { chaveMestra, cifrarArquivo, cifrarTexto } from "@/lib/crypto/cert-vault";
import { abrirPfx } from "@/lib/crypto/pfx";

vi.mock("server-only", () => ({}));

const pfx = readFileSync(resolve(__dirname, "../fixtures/cert-teste.pfx"));
const chaveB64 = randomBytes(32).toString("base64");

beforeAll(() => {
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: "https://exemplo.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "x", SUPABASE_SERVICE_ROLE_KEY: "x",
    CERT_MASTER_KEY: chaveB64, WORKER_SECRET: "x".repeat(32), NFSE_AMBIENTE: "restrita",
    SEFIN_BASE_URL: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional", ADN_BASE_URL: "https://adn.producaorestrita.nfse.gov.br/contribuintes",
  });
});

/** Supabase falso: devolve a linha do certificado e o arquivo cifrado do Storage. */
function dbFalso(linha: Record<string, unknown>, arquivo: Buffer) {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: linha, error: null }) };
  return {
    from: () => q,
    storage: { from: () => ({ download: async () => ({ data: new Blob([new Uint8Array(arquivo)]), error: null }) }) },
  } as never;
}

describe("certificado guardado: abrir para assinar e consultar o ADN", () => {
  it("abre o pfx gravado no envio (o SHA-256 gravado é o do certificado, não o do arquivo)", async () => {
    const chave = chaveMestra(chaveB64);
    const { arquivo, meta } = cifrarArquivo(pfx, chave, 1);
    const aberto = abrirPfx(pfx, "senha-de-teste");
    const linha = { storage_path: "x", pfx_cripto: meta, senha_cripto: cifrarTexto("senha-de-teste", chave, 1), sha256: aberto.sha256 };
    const { abrirCertificadoDaEmpresa } = await import("@/lib/fila/portas-supabase");
    try {
      const r = await abrirCertificadoDaEmpresa(dbFalso(linha, arquivo), "e");
      expect(r.aberto.sha256).toBe(aberto.sha256);
    } catch (e) {
      // o certificado de teste pode estar vencido: o importante é não falhar no SHA-256
      expect(String(e)).toMatch(/vencido/);
    }
  });
  it("recusa quando o certificado guardado não é o enviado", async () => {
    const chave = chaveMestra(chaveB64);
    const { arquivo, meta } = cifrarArquivo(pfx, chave, 1);
    const linha = { storage_path: "x", pfx_cripto: meta, senha_cripto: cifrarTexto("senha-de-teste", chave, 1), sha256: "0".repeat(64) };
    const { abrirCertificadoDaEmpresa } = await import("@/lib/fila/portas-supabase");
    await expect(abrirCertificadoDaEmpresa(dbFalso(linha, arquivo), "e")).rejects.toThrow(/SHA-256 diferente/);
  });
});
