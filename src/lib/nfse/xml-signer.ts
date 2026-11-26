import { SignedXml } from "xml-crypto";

/**
 * XML-DSig enveloped, RSA-SHA256, c14n exclusivo (DESIGN Component "DPS Builder & Signer").
 * Assina o elemento com atributo Id (infDPS ou infPedReg) e põe <Signature> logo depois dele.
 */
const EXC_C14N = "http://www.w3.org/2001/10/xml-exc-c14n#";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";

export function assinarXml(xml: string, elemento: "infDPS" | "infPedReg", chavePrivadaPem: string, certificadoPem: string): string {
  const sig = new SignedXml({
    privateKey: chavePrivadaPem,
    publicCert: certificadoPem,
    signatureAlgorithm: RSA_SHA256,
    canonicalizationAlgorithm: EXC_C14N,
  });
  sig.addReference({
    xpath: `//*[local-name(.)='${elemento}']`,
    transforms: [ENVELOPED, EXC_C14N],
    digestAlgorithm: SHA256,
  });
  sig.computeSignature(xml, {
    location: { reference: `//*[local-name(.)='${elemento}']`, action: "after" },
  });
  return sig.getSignedXml();
}

/** Confere a assinatura (usado nos testes e para validar XML recebido). */
export function assinaturaValida(xmlAssinado: string, certificadoPem: string): boolean {
  const sig = new SignedXml({ publicCert: certificadoPem });
  const m = xmlAssinado.match(/<(?:\w+:)?Signature[\s\S]*<\/(?:\w+:)?Signature>/);
  if (!m) return false;
  sig.loadSignature(m[0]);
  try {
    return sig.checkSignature(xmlAssinado);
  } catch {
    return false;
  }
}
