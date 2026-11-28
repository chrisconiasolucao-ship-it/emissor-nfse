import { describe, expect, it } from "vitest";
import { EmpresaForaDoEscopo, sugerirEmpresa } from "@/lib/empresa/consulta-cnpj";

const base = { razao_social: "EMPRESA A TESTE LTDA", nome_fantasia: "", codigo_municipio_ibge: 4301602, municipio: "BAGE", uf: "RS",
  porte: "MICRO EMPRESA", opcao_pelo_simples: true, opcao_pelo_mei: false, email: "Contato@Teste.com", ddd_telefone_1: "53 3242-0000", descricao_situacao_cadastral: "ATIVA" };

describe("cadastro da empresa pelo certificado + consulta do CNPJ", () => {
  it("ME do Simples: preenche regime, município e contato", () => {
    expect(sugerirEmpresa("11222333000181", "EMPRESA A", base)).toEqual({
      cnpj: "11222333000181", razao_social: "EMPRESA A TESTE LTDA", nome_fantasia: null, regime: "ME",
      cod_municipio: "4301602", municipio: "BAGE/RS", email: "contato@teste.com", telefone: "5332420000", avisos: [] });
  });
  it("EPP e MEI", () => {
    expect(sugerirEmpresa("1", "x", { ...base, porte: "EMPRESA DE PEQUENO PORTE" }).regime).toBe("EPP");
    expect(sugerirEmpresa("1", "x", { ...base, opcao_pelo_mei: true }).regime).toBe("MEI");
  });
  it("AT-024: fora do Simples ou CNPJ baixado é recusado", () => {
    expect(() => sugerirEmpresa("1", "x", { ...base, opcao_pelo_simples: false })).toThrow(EmpresaForaDoEscopo);
    expect(() => sugerirEmpresa("1", "x", { ...base, descricao_situacao_cadastral: "BAIXADA" })).toThrow(EmpresaForaDoEscopo);
  });
  it("porte DEMAIS no Simples: traz os dados e pede para escolher ME ou EPP", () => {
    const s = sugerirEmpresa("1", "x", { ...base, porte: "DEMAIS" });
    expect(s.regime).toBeNull();
    expect(s.cod_municipio).toBe("4301602");
    expect(s.avisos[0]).toMatch(/Escolha o regime/);
  });
  it("sem razão social na consulta usa a do certificado; sem IBGE pede o município pelo nome", () => {
    expect(sugerirEmpresa("1", "NOME DO CERT", { ...base, razao_social: "" }).razao_social).toBe("NOME DO CERT");
    const s = sugerirEmpresa("1", "x", { ...base, codigo_municipio_ibge: null });
    expect(s.cod_municipio).toBeNull();
    expect(s.avisos.join(" ")).toMatch(/pelo nome/);
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

describe("preenchimento do cadastro pelo CNPJ", () => {
  it("monta endereço, município, contato e regime no formato da BrasilAPI", async () => {
    const { preenchimentoDoCnpj } = await import("@/lib/empresa/consulta-cnpj");
    const p = preenchimentoDoCnpj({
      razao_social: "EMPRESA TESTE LTDA", nome_fantasia: "TESTE", codigo_municipio_ibge: 4301602, porte: "MICRO EMPRESA",
      opcao_pelo_simples: true, opcao_pelo_mei: false, email: "Contato@Teste.com.br", ddd_telefone_1: "53 3242-1111",
      descricao_situacao_cadastral: "ATIVA", cep: "96400-000", descricao_tipo_de_logradouro: "RUA", logradouro: "GENERAL OSORIO",
      numero: "100", complemento: "SALA 2", bairro: "CENTRO",
    });
    expect(p).toMatchObject({ razao_social: "EMPRESA TESTE LTDA", cod_municipio: "4301602", cep: "96400000", logradouro: "RUA GENERAL OSORIO",
      numero: "100", email: "contato@teste.com.br", telefone: "5332421111", regime: "ME", aviso: null });
  });
  it("não repete o tipo do logradouro e avisa CNPJ não ativo", async () => {
    const { preenchimentoDoCnpj } = await import("@/lib/empresa/consulta-cnpj");
    const p = preenchimentoDoCnpj({ razao_social: "X", descricao_tipo_de_logradouro: "AVENIDA", logradouro: "AVENIDA SETE", descricao_situacao_cadastral: "BAIXADA" });
    expect(p.logradouro).toBe("AVENIDA SETE");
    expect(p.cod_municipio).toBe("");
    expect(p.aviso).toMatch(/BAIXADA/);
  });
  it("converte o endereço do CNPJ.ws", async () => {
    const { consultarCnpj, preenchimentoDoCnpj } = await import("@/lib/empresa/consulta-cnpj");
    const ws = { razao_social: "Y", estabelecimento: { tipo_logradouro: "Rua", logradouro: "Sete", numero: "5", bairro: "Centro", cep: "96400000",
      cidade: { ibge_id: 4301602 }, estado: { sigla: "RS" } } };
    let n = 0;
    const f = (async () => new Response(JSON.stringify(++n < 3 ? {} : ws), { status: n < 3 ? 503 : 200 })) as unknown as typeof fetch;
    expect(preenchimentoDoCnpj(await consultarCnpj("11222333000181", f))).toMatchObject({ logradouro: "Rua Sete", numero: "5", bairro: "Centro", cod_municipio: "4301602" });
  });
});
