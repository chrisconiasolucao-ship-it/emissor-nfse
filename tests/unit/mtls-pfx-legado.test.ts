import { readFileSync } from "node:fs";
import https from "node:https";
import { createSecureContext } from "node:tls";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pemsParaTls } from "@/lib/crypto/pfx";
import { agenteMtls } from "@/lib/nfse/sefin-client";

// A1 de várias certificadoras vem com RC2/3DES; o OpenSSL 3 do Node recusa esse pfx direto.
const legado = readFileSync(resolve(__dirname, "../fixtures/cert-legado-rc2.pfx"));
const atual = readFileSync(resolve(__dirname, "../fixtures/cert-teste.pfx"));

describe("mTLS com certificado A1", () => {
  it("o pfx legado falha direto no Node (o erro que apareceu na produção)", () => {
    expect(() => createSecureContext({ pfx: legado, passphrase: "senha-legada" })).toThrow(/Unsupported PKCS12 PFX data/);
  });

  it("o agente do mTLS abre o pfx legado pelo node-forge", () => {
    const { key, cert } = pemsParaTls(legado, "senha-legada");
    expect(() => createSecureContext({ key, cert })).not.toThrow();
    expect(agenteMtls(legado, "senha-legada")).toBeInstanceOf(https.Agent);
  });

  it("continua abrindo o pfx atual, com o certificado da empresa primeiro", () => {
    const { key, cert } = pemsParaTls(atual, "senha-de-teste");
    expect(cert.startsWith("-----BEGIN CERTIFICATE-----")).toBe(true);
    expect(() => createSecureContext({ key, cert })).not.toThrow();
  });
});
