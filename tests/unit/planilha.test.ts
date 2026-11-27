import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parecidas } from "@/lib/importacao/duplicidade";
import { gerarModeloPlanilha } from "@/lib/importacao/modelo-planilha";
import { cnpjValido, cpfValido, lerPlanilha, PlanilhaGrandeDemais, PlanilhaInvalida } from "@/lib/importacao/planilha";
import { mesAnterior, rascunhosDoMes } from "@/lib/importacao/repetir-mes";

const fx = (n: string) => readFileSync(resolve(__dirname, "../fixtures", n));
const CAB = "tomador_tipo;tomador_documento;tomador_nome;codigo_tributacao_nacional;descricao;valor;competencia;iss_retido;aliquota_iss";

describe("planilha de notas", () => {
  it("AT-018: 30 linhas válidas viram 30 notas, com valores exatos e SHA-256 do arquivo", async () => {
    const arq = fx("planilha-30.xlsx");
    const r = await lerPlanilha(arq, "planilha-30.xlsx");
    expect(r.erros).toEqual([]);
    expect(r.linhas).toHaveLength(30);
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.linhas[0]).toMatchObject({ valorServico: "101.50", competencia: "2026-11-01", codigoTributacaoNacional: "010601" });
    expect(r.linhas[1]!.valorServico).toBe("102.00");
    // mesmo arquivo, mesmo SHA-256: a 2ª importação é recusada pelo banco (AT-031)
    expect((await lerPlanilha(arq, "copia.xlsx")).sha256).toBe(r.sha256);
  });
  it("AT-017: 31 linhas recusam o arquivo inteiro e pedem para dividir", async () => {
    await expect(lerPlanilha(fx("planilha-31.xlsx"), "planilha-31.xlsx")).rejects.toThrow(PlanilhaGrandeDemais);
    await expect(lerPlanilha(fx("planilha-31.xlsx"), "planilha-31.xlsx")).rejects.toThrow(/Divida em arquivos de até 30/);
  });
  it("CSV com ponto e vírgula, CPF sem zero à esquerda, erros por linha e campo", async () => {
    const csv = [
      CAB,
      "CPF;1234567890;FULANO;10601;Serviço;1.234,56;11/2026;N;",
      "CPF;11111111111;X;010601;Serviço;10;13/2026;S;",
      "CNPJ;11.222.333/0001-81;EMPRESA;010601;Serviço;0;12/2026;S;2,5",
    ].join("\n");
    const r = await lerPlanilha(Buffer.from(csv), "notas.csv");
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({ linha: 2, valorServico: "1234.56", codigoTributacaoNacional: "010601" });
    expect(r.linhas[0]!.tomador.documento).toBe("01234567890");
    expect(r.erros.filter((e) => e.linha === 3).map((e) => e.campo).sort()).toEqual(["aliquota_iss", "competencia", "tomador_documento"]);
    expect(r.erros.filter((e) => e.linha === 4).map((e) => e.campo)).toEqual(["valor"]);
  });
  it("arquivo fora do modelo ou de outro formato é recusado", async () => {
    await expect(lerPlanilha(Buffer.from("a;b\n1;2"), "x.csv")).rejects.toThrow(PlanilhaInvalida);
    await expect(lerPlanilha(Buffer.from("x"), "x.pdf")).rejects.toThrow(PlanilhaInvalida);
  });
  it("o modelo para download é lido sem erro de cabeçalho", async () => {
    const r = await lerPlanilha(await gerarModeloPlanilha(), "modelo.xlsx");
    expect(r.linhas).toHaveLength(1); // a linha de exemplo
  });
  it("dígitos verificadores", () => {
    expect(cpfValido("52998224725")).toBe(true);
    expect(cpfValido("52998224724")).toBe(false);
    expect(cnpjValido("11222333000181")).toBe(true);
    expect(cnpjValido("11222333000182")).toBe(false);
  });
});

describe("duplicidade (AT-022) e repetir mês (AT-020)", () => {
  const base = { empresaId: "A", tomadorId: "t1", valorServico: "1350.00", descricao: "Assessoria  Contábil", competencia: "2026-11-01" };
  it("acha nota parecida ignorando espaço/acento/caixa e valor 1350 = 1350.00", () => {
    const r = parecidas({ ...base, valorServico: "1350" }, [
      { ...base, id: "x", descricao: "assessoria contabil", situacao: "autorizada" },
      { ...base, id: "y", situacao: "cancelada" },
      { ...base, id: "z", tomadorId: "t2", situacao: "autorizada" },
    ]);
    expect(r.map((n) => n.id)).toEqual(["x"]);
  });
  it("repetir mês cria um rascunho por autorizada, com a competência nova", () => {
    expect(mesAnterior("2027-01-01")).toBe("2026-12-01");
    const r = rascunhosDoMes(
      [{ id: "n1", tomadorId: "t1", servicoId: "s1", codigoTributacaoNacional: "010601", codigoNbs: null, descricao: "d", codMunicipioPrestacao: "4301602", valorServico: "10.00", issRetido: false, aliquotaIss: null }],
      "2026-12-01",
    );
    expect(r).toEqual([expect.objectContaining({ competencia: "2026-12-01", origem: "repeticao", notaModeloId: "n1", valorServico: "10.00" })]);
  });
});

describe("planilha: retenções federais (27/11/2026)", () => {
  it("lê ret_inss/ret_irrf/ret_csll/ret_pis/ret_cofins; vazio é sem retenção; inválido vira erro da linha", async () => {
    const csv = [
      CAB + ";ret_inss;ret_irrf;ret_csll;ret_pis;ret_cofins",
      "CPF;52998224725;FULANO;010601;Serviço;1000;11/2026;N;;11;1,5;1;0,65;3",
      "CPF;52998224725;FULANO;010601;Serviço;1000;11/2026;N;;;;;;",
      "CPF;52998224725;FULANO;010601;Serviço;1000;11/2026;N;;150;;;;",
    ].join("\n");
    const r = await lerPlanilha(Buffer.from(csv), "ret.csv");
    expect(r.linhas[0]!.retencoes).toEqual({ inss: "11.00", irrf: "1.50", csll: "1.00", pis: "0.65", cofins: "3.00" });
    expect(r.linhas[1]!.retencoes).toEqual({ inss: null, irrf: null, csll: null, pis: null, cofins: null });
    expect(r.erros).toEqual([expect.objectContaining({ linha: 4, campo: "ret_inss" })]);
  });
});
