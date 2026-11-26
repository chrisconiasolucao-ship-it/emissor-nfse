import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chaveMunicipio, lerMunicipios, type MapaIbge } from "@/lib/importacao/municipios";

// Recorte da lista oficial do IBGE com os nomes atuais
const ibge: MapaIbge = new Map([
  [chaveMunicipio("RS", "Bagé"), "4301602"],
  [chaveMunicipio("SP", "Iperó"), "3521002"],
  [chaveMunicipio("PR", "Munhoz de Melo"), "4116307"],
]);
const planilha = readFileSync("tests/fixtures/municipios-aderentes-amostra.csv"); // Latin-1, ";" — como a Receita publica

describe("importação dos municípios aderentes (planilha da Receita)", () => {
  it("lê Latin-1 com ';', casa UF + nome com o IBGE e interpreta as colunas", async () => {
    const r = await lerMunicipios(planilha, "municipios-aderentes-20261124.csv", async () => ibge);
    expect(r.lidos).toEqual([
      { codIbge: "4301602", nome: "BAGE", uf: "RS", conveniado: true, ativoOperacional: true, emissorNacional: false },
      { codIbge: "3521002", nome: "IPERO", uf: "SP", conveniado: true, ativoOperacional: false, emissorNacional: true },
      { codIbge: "4116307", nome: "MUNHOZ DE MELLO", uf: "PR", conveniado: true, ativoOperacional: true, emissorNacional: true },
    ]);
    expect(r.semCodigo).toEqual(["CIDADE INEXISTENTE/PA"]);
  });

  it("só busca a lista do IBGE quando o arquivo não traz o código", async () => {
    let chamou = false;
    const csv = Buffer.from("codigo ibge;municipio;uf;conveniado;situacao;emissor nacional\n4301602;Bagé;RS;sim;ativo;não\n");
    const r = await lerMunicipios(csv, "x.csv", async () => { chamou = true; return ibge; });
    expect(chamou).toBe(false);
    expect(r.lidos[0]).toMatchObject({ codIbge: "4301602", ativoOperacional: true, emissorNacional: false });
  });

  it("recusa arquivo de outro formato com mensagem clara", async () => {
    await expect(lerMunicipios(Buffer.from("a;b\n1;2\n"), "x.csv", async () => ibge)).rejects.toThrow(/Formato não reconhecido/);
  });
});
