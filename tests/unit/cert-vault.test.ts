import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { chaveMestra, cifrarArquivo, cifrarTexto, decifrar, decifrarArquivo, decifrarTexto } from "@/lib/crypto/cert-vault";
import { abrirPfx, CertificadoVencido, diasParaVencer, exigirValido, SenhaCertificadoInvalida } from "@/lib/crypto/pfx";

const pfx = readFileSync(resolve(__dirname, "../fixtures/cert-teste.pfx"));
const chave = randomBytes(32);

describe("cofre do certificado (AT-022, AT-023)", () => {
  it("cifra e decifra o pfx e a senha; o cifrado não contém o original", () => {
    const { arquivo, meta } = cifrarArquivo(pfx, chave, 1);
    expect(arquivo.equals(pfx)).toBe(false);
    expect(decifrarArquivo(arquivo, meta, chave).equals(pfx)).toBe(true);
    const s = cifrarTexto("senha-de-teste", chave, 1);
    expect(JSON.stringify(s)).not.toContain("senha-de-teste");
    expect(decifrarTexto(s, chave)).toBe("senha-de-teste");
  });
  it("chave errada ou dado adulterado falha (GCM autentica)", () => {
    const s = cifrarTexto("senha-de-teste", chave, 1);
    expect(() => decifrarTexto(s, randomBytes(32))).toThrow();
    const dados = Buffer.from(s.dados, "base64");
    dados[0] = (dados[0] ?? 0) ^ 1;
    expect(() => decifrar({ ...s, dados: dados.toString("base64") }, chave)).toThrow();
  });
  it("chave mestra precisa ter 32 bytes", () => {
    expect(() => chaveMestra(randomBytes(16).toString("base64"))).toThrow();
    expect(chaveMestra(chave.toString("base64")).length).toBe(32);
  });
});

describe("leitura do pfx", () => {
  it("lê titular, CNPJ e validade", () => {
    const c = abrirPfx(pfx, "senha-de-teste");
    expect(c.titular).toBe("EMPRESA A TESTE LTDA");
    expect(c.cnpjTitular).toBe("11222333000181");
    expect(c.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(c.chavePrivadaPem).toContain("PRIVATE KEY");
    expect(diasParaVencer(c.validoAte)).toBeGreaterThan(300);
  });
  it("senha errada é recusada com mensagem própria", () => {
    expect(() => abrirPfx(pfx, "errada")).toThrow(SenhaCertificadoInvalida);
  });
  it("certificado vencido é recusado (pfx 3DES legado também abre)", () => {
    const vencido = abrirPfx(readFileSync(resolve(__dirname, "../fixtures/cert-teste-3des.pfx")), "senha-de-teste");
    expect(() => exigirValido(vencido, new Date("2030-01-01"))).toThrow(CertificadoVencido);
  });
});
