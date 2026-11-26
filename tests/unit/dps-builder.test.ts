import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { montarDps, type DadosDps } from "@/lib/nfse/dps-builder";
import { montarIdDps } from "@/lib/nfse/dps-id";

const XSD = resolve(__dirname, "../fixtures/xsd-v1.01/DPS_v1.01.xsd");

function validarXsd(xml: string): { ok: boolean; saida: string } {
  const dir = mkdtempSync(join(tmpdir(), "dps-"));
  const arq = join(dir, "dps.xml");
  writeFileSync(arq, xml);
  try {
    const saida = execFileSync("xmllint", ["--noout", "--schema", XSD, arq], { stdio: "pipe" }).toString();
    return { ok: true, saida };
  } catch (e) {
    const err = e as { stderr?: Buffer };
    return { ok: false, saida: err.stderr?.toString() ?? String(e) };
  }
}

const base: DadosDps = {
  ambiente: "restrita",
  emitidaEm: new Date("2026-11-10T12:15:00Z"),
  serie: "900",
  numero: 63,
  competencia: "2026-11-01",
  prestador: { cnpj: "11222333000181", codMunicipio: "4301602", opSimpNac: 3, aliquotaSimples: "6.00" },
  tomador: {
    tipoDocumento: "CPF",
    documento: "529.982.247-25",
    nome: "MARIA DE TESTE",
    email: "maria@example.com",
    endereco: { codMunicipio: "4301602", cep: "96400-000", logradouro: "RUA DAS FLORES", numero: "100", bairro: "CENTRO" },
  },
  servico: { codMunicipioPrestacao: "4301602", codigoTributacaoNacional: "010601", codigoNbs: "113032000", descricao: "Assessoria contábil & fiscal <11/2026>" },
  valores: { valorServico: "1.350,00", issRetido: false },
};

describe("dps-id", () => {
  it("tem 45 posições no formato DPS+cMun+2+CNPJ+série+nDPS", () => {
    const id = montarIdDps("4301602", "11222333000181", "900", 63);
    expect(id).toBe("DPS4301602211222333000181" + "00900" + "000000000000063");
    expect(id).toHaveLength(45);
  });
});

describe("montarDps (AT-004)", () => {
  it("gera DPS válida no XSD v1.00, com valor em ponto e texto escapado", () => {
    const { xml, idDps } = montarDps(base);
    expect(idDps).toHaveLength(45);
    expect(xml).toContain("<vServ>1350.00</vServ>");
    expect(xml).toContain("<tpAmb>2</tpAmb>");
    expect(xml).toContain("<dhEmi>2026-11-10T09:15:00-03:00</dhEmi>");
    expect(xml).toContain("&amp; fiscal &lt;11/2026&gt;");
    expect(xml).toContain("<CPF>52998224725</CPF>");
    const v = validarXsd(xml);
    expect(v.saida).not.toMatch(/fails to validate/);
    expect(v.ok).toBe(true);
  });
  it("série 90001 é recusada pelo esquema (E1235 na Sefin); 900 passa", () => {
    expect(validarXsd(montarDps({ ...base, serie: "90001" }).xml).ok).toBe(false);
    expect(validarXsd(montarDps({ ...base, serie: "900" }).xml).ok).toBe(true);
  });
  it("ME informa pTotTribSN (E0712); MEI informa indTotTrib; ME sem alíquota não monta", () => {
    expect(montarDps(base).xml).toContain("<totTrib><pTotTribSN>6.00</pTotTribSN></totTrib>");
    const mei = montarDps({ ...base, prestador: { ...base.prestador, opSimpNac: 2, aliquotaSimples: null } }).xml;
    expect(mei).toContain("<totTrib><indTotTrib>0</indTotTrib></totTrib>");
    expect(validarXsd(mei).ok).toBe(true);
    expect(() => montarDps({ ...base, prestador: { ...base.prestador, aliquotaSimples: null } })).toThrow(/alíquota do Simples/);
  });
  it("MEI não informa regApTribSN; ISS retido informa pAliq com 2 casas", () => {
    const { xml } = montarDps({ ...base, prestador: { ...base.prestador, opSimpNac: 2 }, valores: { valorServico: "100", issRetido: true, aliquotaIss: "2,5" } });
    expect(xml).not.toContain("regApTribSN");
    expect(xml).toContain("<tpRetISSQN>2</tpRetISSQN><pAliq>2.50</pAliq>");
    expect(validarXsd(xml).ok).toBe(true);
  });
  it("substituição gera grupo subst válido", () => {
    const { xml } = montarDps({ ...base, substituicao: { chaveSubstituida: "4".repeat(50), codigoMotivo: "01", motivo: "Correção do valor cobrado" } });
    expect(xml).toContain("<subst><chSubstda>");
    expect(validarXsd(xml).ok).toBe(true);
  });
  it("recusa valor zero, descrição vazia, retido sem alíquota e alíquota ≥ 10", () => {
    expect(() => montarDps({ ...base, valores: { valorServico: "0", issRetido: false } })).toThrow();
    expect(() => montarDps({ ...base, servico: { ...base.servico, descricao: "  " } })).toThrow();
    expect(() => montarDps({ ...base, valores: { valorServico: "10", issRetido: true } })).toThrow();
    expect(() => montarDps({ ...base, valores: { valorServico: "10", issRetido: true, aliquotaIss: "10" } })).toThrow();
  });
});
