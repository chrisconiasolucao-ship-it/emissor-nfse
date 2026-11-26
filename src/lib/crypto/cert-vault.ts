import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cofre do certificado A1 (Decision 2 do brainstorm, AT-013): AES-256-GCM com chave fora do banco
 * (CERT_MASTER_KEY no ambiente da Vercel). Decifrado só na hora de assinar.
 */
export type Cifrado = { iv: string; tag: string; dados: string; keyVersion: number };
export type MetaCifra = Omit<Cifrado, "dados">;

export function chaveMestra(base64: string): Buffer {
  const k = Buffer.from(base64, "base64");
  if (k.length !== 32) throw new Error("CERT_MASTER_KEY precisa ter 32 bytes");
  return k;
}

export function cifrar(claro: Buffer, chave: Buffer, keyVersion: number): Cifrado {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave, iv);
  const dados = Buffer.concat([c.update(claro), c.final()]);
  return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), dados: dados.toString("base64"), keyVersion };
}

export function decifrar(x: Cifrado, chave: Buffer): Buffer {
  const d = createDecipheriv("aes-256-gcm", chave, Buffer.from(x.iv, "base64"));
  d.setAuthTag(Buffer.from(x.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(x.dados, "base64")), d.final()]);
}

/** Separa o binário cifrado (vai para o Storage) dos metadados (vão para o banco). */
export function cifrarArquivo(claro: Buffer, chave: Buffer, keyVersion: number): { arquivo: Buffer; meta: MetaCifra } {
  const { dados, ...meta } = cifrar(claro, chave, keyVersion);
  return { arquivo: Buffer.from(dados, "base64"), meta };
}

export function decifrarArquivo(arquivo: Buffer, meta: MetaCifra, chave: Buffer): Buffer {
  return decifrar({ ...meta, dados: arquivo.toString("base64") }, chave);
}

export function cifrarTexto(texto: string, chave: Buffer, keyVersion: number): Cifrado {
  return cifrar(Buffer.from(texto, "utf8"), chave, keyVersion);
}

export function decifrarTexto(x: Cifrado, chave: Buffer): string {
  return decifrar(x, chave).toString("utf8");
}
