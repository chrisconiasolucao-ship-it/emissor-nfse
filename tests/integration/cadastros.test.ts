import { afterAll, describe, expect, it } from "vitest";
import { cenario, como, emTransacao, fecharBanco, recusa } from "./_db";

afterAll(fecharBanco);

describe("cadastro de serviços e tomadores por empresa (0014)", () => {
  it("o mesmo serviço (código + descrição) não entra duas vezes na empresa; em outra empresa pode", async () => {
    await emTransacao(async (tx) => {
      const c = await cenario(tx);
      await tx.query("insert into servico (empresa_id, codigo_tributacao_nacional, descricao, origem) values ($1,'171901','Honorários contábeis','xml')", [c.A]);
      expect(await recusa(tx, "insert into servico (empresa_id, codigo_tributacao_nacional, descricao) values ($1,'171901','  honorários CONTÁBEIS ')", [c.A])).toBe("23505");
      await tx.query("insert into servico (empresa_id, codigo_tributacao_nacional, descricao) values ($1,'171901','Honorários contábeis')", [c.B]);
      const r = await tx.query("select origem, ativo, iss_retido from servico where empresa_id = $1 and codigo_tributacao_nacional = '171901'", [c.A]);
      expect(r.rows[0]).toEqual({ origem: "xml", ativo: true, iss_retido: false });
    });
  });

  it("valor sugerido e origem são conferidos pelo banco", async () => {
    await emTransacao(async (tx) => {
      const c = await cenario(tx);
      expect(await recusa(tx, "insert into servico (empresa_id, codigo_tributacao_nacional, descricao, valor_padrao) values ($1,'171901','X',0)", [c.A])).toBe("23514");
      expect(await recusa(tx, "insert into servico (empresa_id, codigo_tributacao_nacional, descricao, origem) values ($1,'171901','X','outra')", [c.A])).toBe("23514");
      expect(await recusa(tx, "insert into tomador (empresa_id, tipo_documento, documento, nome, origem) values ($1,'CPF','39053344705','X','outra')", [c.A])).toBe("23514");
    });
  });

  it("usuário da empresa A cadastra e edita serviços de A, mas não vê nem grava os de B", async () => {
    await emTransacao(async (tx) => {
      const c = await cenario(tx);
      await tx.query("insert into servico (empresa_id, codigo_tributacao_nacional, descricao) values ($1,'171901','Serviço de B')", [c.B]);
      await como(tx, "authenticated", c.u.userA);
      const ins = await tx.query("insert into servico (empresa_id, nome, codigo_tributacao_nacional, descricao, valor_padrao) values ($1,'Mensal','171901','Serviço de A',350.5) returning id", [c.A]);
      await tx.query("update servico set nome = 'Mensal 2' where id = $1", [ins.rows[0].id]);
      expect((await tx.query("select count(*)::int n from servico where empresa_id = $1", [c.B])).rows[0].n).toBe(0);
      await recusa(tx, "insert into servico (empresa_id, codigo_tributacao_nacional, descricao) values ($1,'171901','invasão')", [c.B]);
    });
  });
});
