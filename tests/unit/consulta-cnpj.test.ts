import { describe, expect, it } from "vitest";
import { EmpresaForaDoEscopo, sugerirEmpresa } from "@/lib/empresa/consulta-cnpj";

const base = { razao_social: "EMPRESA A TESTE LTDA", nome_fantasia: "", codigo_municipio_ibge: 4301602, municipio: "BAGE", uf: "RS",
  porte: "MICRO EMPRESA", opcao_pelo_simples: true, opcao_pelo_mei: false, email: "Contato@Teste.com", ddd_telefone_1: "53 3242-0000", descricao_situacao_cadastral: "ATIVA" };

describe("cadastro da empresa pelo certificado + consulta do CNPJ", () => {
  it("ME do Simples: preenche regime, município e contato", () => {
    expect(sugerirEmpresa("11222333000181", "EMPRESA A", base)).toEqual({
      cnpj: "11222333000181", razao_social: "EMPRESA A TESTE LTDA", nome_fantasia: null, regime: "ME",
      cod_municipio: "4301602", municipio: "BAGE/RS", email: "contato@teste.com", telefone: "5332420000" });
  });
  it("EPP e MEI", () => {
    expect(sugerirEmpresa("1", "x", { ...base, porte: "EMPRESA DE PEQUENO PORTE" }).regime).toBe("EPP");
    expect(sugerirEmpresa("1", "x", { ...base, opcao_pelo_mei: true }).regime).toBe("MEI");
  });
  it("AT-024: fora do Simples, baixada ou sem porte claro é recusada", () => {
    expect(() => sugerirEmpresa("1", "x", { ...base, opcao_pelo_simples: false })).toThrow(EmpresaForaDoEscopo);
    expect(() => sugerirEmpresa("1", "x", { ...base, descricao_situacao_cadastral: "BAIXADA" })).toThrow(EmpresaForaDoEscopo);
    expect(() => sugerirEmpresa("1", "x", { ...base, porte: "DEMAIS" })).toThrow(EmpresaForaDoEscopo);
  });
  it("sem razão social na consulta usa a do certificado; sem IBGE pede cadastro à mão", () => {
    expect(sugerirEmpresa("1", "NOME DO CERT", { ...base, razao_social: "" }).razao_social).toBe("NOME DO CERT");
    expect(() => sugerirEmpresa("1", "x", { ...base, codigo_municipio_ibge: null })).toThrow(/à mão/);
  });
});

describe("consulta do CNPJ com fontes alternativas", () => {
  const resp = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status });
  it("se a primeira fonte recusa (403), usa a próxima", async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(u); return urls.length === 1 ? resp(403, {}) : resp(200, { razao_social: "X" }); }) as unknown as typeof fetch;
    const { consultarCnpj } = await import("@/lib/empresa/consulta-cnpj");
    expect((await consultarCnpj("11222333000181", f)).razao_social).toBe("X");
    expect(urls.length).toBe(2);
  });
  it("converte o formato do CNPJ.ws", async () => {
    const ws = { razao_social: "Y", porte: { descricao: "Micro Empresa" }, simples: { simples: "Sim", mei: "Não" },
      estabelecimento: { situacao_cadastral: "Ativa", cidade: { ibge_id: 4301602, nome: "Bagé" }, estado: { sigla: "RS" } } };
    let n = 0;
    const f = (async () => (++n < 3 ? resp(503, {}) : resp(200, ws))) as unknown as typeof fetch;
    const { consultarCnpj } = await import("@/lib/empresa/consulta-cnpj");
    expect(sugerirEmpresa("11222333000181", "Y", await consultarCnpj("11222333000181", f))).toMatchObject({ regime: "ME", cod_municipio: "4301602" });
  });
  it("todas falhando: mensagem diz quais fontes falharam", async () => {
    const f = (async () => resp(403, {})) as unknown as typeof fetch;
    const { consultarCnpj } = await import("@/lib/empresa/consulta-cnpj");
    await expect(consultarCnpj("1", f)).rejects.toThrow(/BrasilAPI HTTP 403, Minha Receita HTTP 403, CNPJ.ws HTTP 403/);
  });
});
