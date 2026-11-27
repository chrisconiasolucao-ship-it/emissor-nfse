import forge from "node-forge";
import { createHash } from "node:crypto";

export type CertificadoAberto = {
  chavePrivadaPem: string;
  certificadoPem: string;
  titular: string;
  cnpjTitular: string | null;
  validoDe: Date;
  validoAte: Date;
  sha256: string;
};

export class SenhaCertificadoInvalida extends Error {
  constructor() {
    super("senha do certificado inválida ou arquivo pfx corrompido");
  }
}

export class CertificadoVencido extends Error {
  constructor(public validoAte: Date) {
    super(`certificado vencido em ${validoAte.toISOString().slice(0, 10)}`);
  }
}

/** Abre o pfx (PKCS#12) e devolve chave, certificado e metadados. Não guarda nada. */
export function abrirPfx(pfx: Buffer, senha: string): CertificadoAberto {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString("binary")));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
  } catch {
    throw new SenhaCertificadoInvalida();
  }
  const OID_SHROUDED = forge.pki.oids.pkcs8ShroudedKeyBag as string;
  const OID_KEY = forge.pki.oids.keyBag as string;
  const OID_CERT = forge.pki.oids.certBag as string;
  const chaves: forge.pkcs12.Bag[] = [
    ...(p12.getBags({ bagType: OID_SHROUDED })[OID_SHROUDED] ?? []),
    ...(p12.getBags({ bagType: OID_KEY })[OID_KEY] ?? []),
  ];
  const certs: forge.pkcs12.Bag[] = p12.getBags({ bagType: OID_CERT })[OID_CERT] ?? [];
  const chave = chaves.find((b) => b.key)?.key;
  if (!chave) throw new SenhaCertificadoInvalida();
  // o certificado da empresa é o que casa com a chave (os demais são da cadeia ICP-Brasil)
  const pub = forge.pki.setRsaPublicKey((chave as forge.pki.rsa.PrivateKey).n, (chave as forge.pki.rsa.PrivateKey).e);
  const dono =
    certs.find((b: forge.pkcs12.Bag) => b.cert && forge.pki.publicKeyToPem(b.cert.publicKey) === forge.pki.publicKeyToPem(pub))?.cert ??
    certs[0]?.cert;
  if (!dono) throw new SenhaCertificadoInvalida();

  const cn = String(dono.subject.getField("CN")?.value ?? "");
  const cnpj = cn.match(/(\d{14})\s*$/)?.[1] ?? null;
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(dono)).getBytes();
  return {
    chavePrivadaPem: forge.pki.privateKeyToPem(chave),
    certificadoPem: forge.pki.certificateToPem(dono),
    titular: cn.replace(/:\d{14}\s*$/, ""),
    cnpjTitular: cnpj,
    validoDe: dono.validity.notBefore,
    validoAte: dono.validity.notAfter,
    sha256: createHash("sha256").update(Buffer.from(der, "binary")).digest("hex"),
  };
}

/**
 * Chave e cadeia em PEM para o TLS (mTLS da Sefin/ADN). O Node (OpenSSL 3) recusa pfx com criptografia antiga
 * (RC2/3DES, comum em A1 de várias certificadoras): "Unsupported PKCS12 PFX data". O node-forge lê esses
 * arquivos, então o TLS recebe chave e certificados já abertos, com o certificado da empresa primeiro.
 */
export function pemsParaTls(pfx: Buffer, senha: string): { key: string; cert: string } {
  const aberto = abrirPfx(pfx, senha);
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString("binary")));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
  const OID_CERT = forge.pki.oids.certBag as string;
  const cadeia = (p12.getBags({ bagType: OID_CERT })[OID_CERT] ?? [])
    .map((b) => (b.cert ? forge.pki.certificateToPem(b.cert) : null))
    .filter((pem): pem is string => !!pem && pem !== aberto.certificadoPem);
  return { key: aberto.chavePrivadaPem, cert: [aberto.certificadoPem, ...cadeia].join("") };
}

/** AT-007: certificado vencido não assina; o worker pausa a empresa. */
export function exigirValido(c: CertificadoAberto, agora = new Date()): CertificadoAberto {
  if (c.validoAte.getTime() <= agora.getTime()) throw new CertificadoVencido(c.validoAte);
  return c;
}

/** Dias até o vencimento (arredondado para baixo). */
export function diasParaVencer(validoAte: Date, agora = new Date()): number {
  return Math.floor((validoAte.getTime() - agora.getTime()) / 86_400_000);
}

/**
 * Qual alerta de vencimento cabe hoje (AT-025): aos 30 dias (ou menos) e de novo aos 15, uma vez cada.
 * Devolve o campo a marcar no certificado ou null.
 */
export function alertaDeVencimento(
  c: { validoAte: Date; alerta30Em: Date | null; alerta15Em: Date | null },
  dias: number[] = [30, 15],
  agora = new Date(),
): "alerta_30_em" | "alerta_15_em" | null {
  const restam = diasParaVencer(c.validoAte, agora);
  const [primeiro, segundo] = [Math.max(...dias), Math.min(...dias)];
  if (restam <= segundo && !c.alerta15Em) return "alerta_15_em";
  if (restam <= primeiro && !c.alerta30Em) return "alerta_30_em";
  return null;
}
