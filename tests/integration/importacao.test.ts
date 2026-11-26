import { afterAll, describe, expect, it } from "vitest";
import { cenario, como, emTransacao, fecharBanco, recusa } from "./_db";

afterAll(fecharBanco);

describe("importação e cadastro (AT-020, AT-022, AT-024, AT-031)", () => {
  it("AT-024: empresa fora do Simples/MEI não é cadastrada", async () => {
    await emTransacao(async (tx) => {
      const c = await cenario(tx);
      await como(tx, "authenticated", c.u.escritorio);
      expect(await recusa(tx, "insert into empresa (cnpj, razao_social, regime, cod_municipio) values ('12345678000195','X','LUCRO_PRESUMIDO','4301602')")).toBe("22P02");
      const r = await tx.query("select op_simp_nac from empresa where id = $1", [c.A]);
      expect(r.rows[0].op_simp_nac).toBe(3);
    });
  });

  it("AT-031: mesmo arquivo (SHA-256), mesma chave de acesso e mesma DPS são recusados; contagem não muda", async () => {
    await emTransacao(async (tx) => {
      const c = await cenario(tx);
      await como(tx, "service_role");
      const antes = (await tx.query("select count(*)::int n from nota where empresa_id = $1", [c.A])).rows[0].n;
      const doc = await tx.query("insert into documento (empresa_id, tipo, storage_path, sha256, tamanho, content_type) values ($1,'planilha','p.xlsx',$2,1,'x') returning id", [c.A, "c".repeat(64)]);
      expect(await recusa(tx, "insert into documento (empresa_id, tipo, storage_path, sha256, tamanho, content_type) values ($1,'planilha','p2.xlsx',$2,1,'x')", [c.A, "c".repeat(64)])).toBe("23505");
      await tx.query("insert into importacao (empresa_id, tipo, documento_id) values ($1,'planilha',$2)", [c.A, doc.rows[0].id]);
      expect(await recusa(tx, "insert into importacao (empresa_id, tipo, documento_id) values ($1,'planilha',$2)", [c.A, doc.rows[0].id])).toBe("23505");
      const n = (await tx.query("select chave_acesso, serie_dps, numero_dps from nota where id = $1", [c.notaA])).rows[0];
      expect(await recusa(tx, "insert into nota (empresa_id, descricao, chave_acesso) values ($1,'dup',$2)", [c.A, n.chave_acesso])).toBe("23505");
      expect(await recusa(tx, "insert into nota (empresa_id, descricao, serie_dps, numero_dps) values ($1,'dup',$2,$3)", [c.A, n.serie_dps, n.numero_dps])).toBe("23505");
      expect((await tx.query("select count(*)::int n from nota where empresa_id = $1", [c.A])).rows[0].n).toBe(antes);
    });
  });

  it("AT-020/AT-031: repetir o mesmo mês duas vezes não duplica", async () => {
    await emTransacao(async (tx) => {
      const c = await cenario(tx);
      await como(tx, "service_role");
      await tx.query("insert into importacao (empresa_id, tipo, competencia) values ($1,'repeticao','2026-12-01')", [c.A]);
      expect(await recusa(tx, "insert into importacao (empresa_id, tipo, competencia) values ($1,'repeticao','2026-12-01')", [c.A])).toBe("23505");
    });
  });

  it("AT-022: nota incompleta não vai para a fila; completa vai e recebe data de entrada", async () => {
    await emTransacao(async (tx) => {
      const c = await cenario(tx);
      await como(tx, "authenticated", c.u.userA);
      const r = await tx.query("insert into nota (empresa_id, descricao) values ($1,'rascunho') returning id", [c.A]);
      expect(await recusa(tx, "update nota set situacao = 'na_fila' where id = $1", [r.rows[0].id])).toBe("23514");
      await tx.query(
        "update nota set tomador_id = $2, valor_servico = 1350.00, competencia = '2026-11-01', codigo_tributacao_nacional = '010601', cod_municipio_prestacao = '4301602', situacao = 'na_fila', duplicidade_confirmada = true where id = $1",
        [r.rows[0].id, c.tomA],
      );
      const n = (await tx.query("select situacao, enfileirada_em is not null as entrou, duplicidade_confirmada from nota where id = $1", [r.rows[0].id])).rows[0];
      expect(n).toEqual({ situacao: "na_fila", entrou: true, duplicidade_confirmada: true });
    });
  });
});
