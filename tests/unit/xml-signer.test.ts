import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { abrirPfx } from "@/lib/crypto/pfx";
import { montarDps } from "@/lib/nfse/dps-builder";
import { montarPedidoCancelamento } from "@/lib/nfse/evento-builder";
import { assinarXml, assinaturaValida } from "@/lib/nfse/xml-signer";

const cert = abrirPfx(readFileSync(resolve(__dirname, "../fixtures/cert-teste.pfx")), "senha-de-teste");

const { xml } = montarDps({
  ambiente: "restrita",
  emitidaEm: new Date("2026-11-10T12:00:00Z"),
  serie: "90001",
  numero: 1,
  competencia: "2026-11-01",
  prestador: { cnpj: "11222333000181", codMunicipio: "4301602", opSimpNac: 3 },
  tomador: { tipoDocumento: "CPF", documento: "52998224725", nome: "MARIA DE TESTE" },
  servico: { codMunicipioPrestacao: "4301602", codigoTributacaoNacional: "010601", descricao: "Serviço" },
  valores: { valorServico: "10.00", issRetido: false },
});

describe("assinatura XMLDSig (AT-004)", () => {
  it("assina infDPS com RSA-SHA256 e a assinatura confere", () => {
    const assinado = assinarXml(xml, "infDPS", cert.chavePrivadaPem, cert.certificadoPem);
    expect(assinado).toContain("http://www.w3.org/2001/04/xmldsig-more#rsa-sha256");
    expect(assinado).toMatch(/<Reference URI="#DPS\d{42}"/);
    expect(assinaturaValida(assinado, cert.certificadoPem)).toBe(true);
  });
  it("qualquer alteração depois de assinar invalida a assinatura", () => {
    const assinado = assinarXml(xml, "infDPS", cert.chavePrivadaPem, cert.certificadoPem);
    expect(assinaturaValida(assinado.replace("<vServ>10.00</vServ>", "<vServ>99.00</vServ>"), cert.certificadoPem)).toBe(false);
  });
  it("assina o pedido de cancelamento (infPedReg)", () => {
    const p = montarPedidoCancelamento({
      ambiente: "restrita",
      cnpjAutor: "11222333000181",
      chaveAcesso: "4".repeat(50),
      codigoMotivo: "1",
      motivo: "Erro na emissão do valor",
      em: new Date("2026-11-11T12:00:00Z"),
    });
    expect(p.id).toBe("PRE" + "4".repeat(50) + "101101001");
    const assinado = assinarXml(p.xml, "infPedReg", cert.chavePrivadaPem, cert.certificadoPem);
    expect(assinaturaValida(assinado, cert.certificadoPem)).toBe(true);
  });
  it("cancelamento exige motivo de 15 a 255 caracteres", () => {
    const a = { ambiente: "restrita" as const, cnpjAutor: "11222333000181", chaveAcesso: "4".repeat(50), codigoMotivo: "9" as const, em: new Date() };
    expect(() => montarPedidoCancelamento({ ...a, motivo: "curto" })).toThrow();
    expect(() => montarPedidoCancelamento({ ...a, motivo: "x".repeat(256) })).toThrow();
  });
});
