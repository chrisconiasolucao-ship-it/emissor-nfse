import { afterAll, describe, expect, it } from "vitest";
import { cenario, como, emTransacao, fecharBanco, recusa } from "./_db";

afterAll(fecharBanco);

describe("isolamento por CNPJ (AT-010, AT-032) e permissões (AT-011, AT-014, AT-026)", () => {
  it("AT-010/AT-032: usuário de A não vê nada de B e não grava em B", async () => {
    await emTransacao(async (tx) => {
      const c = await cenario(tx);
      await como(tx, "authenticated", c.u.userA);
      for (const t of ["nota", "tomador", "documento", "certificado", "evento_nota", "importacao"]) {
        const r = await tx.query(`select count(*)::int n from ${t} where empresa_id = $1`, [c.B]);
        expect(r.rows[0].n, t).toBe(0);
      }
      expect((await tx.query("select count(*)::int n from empresa where id = $1", [c.B])).rows[0].n).toBe(0);
      expect((await tx.query("select count(*)::int n from nota where empresa_id = $1", [c.A])).rows[0].n).toBe(1);
      // trilha, avisos e log de segurança: cliente não vê
      for (const t of ["aviso", "log_seguranca", "ancora_auditoria"]) {
        expect((await tx.query(`select count(*)::int n from ${t}`)).rows[0].n, t).toBe(0);
      }
      expect((await tx.query("select count(*)::int n from auditoria where empresa_id = $1", [c.B])).rows[0].n).toBe(0);
      // gravação em B recusada
      await recusa(tx, "insert into tomador (empresa_id, tipo_documento, documento, nome) values ($1,'CPF','39053344705','X')", [c.B]);
      await recusa(tx, "insert into nota (empresa_id, descricao) values ($1,'x')", [c.B]);
      // nota de A apontando para tomador de B: chave estrangeira composta (G13)
      await recusa(tx, "insert into nota (empresa_id, descricao, tomador_id) values ($1,'x',$2)", [c.A, c.tomB]);
      // arquivo do Storage de B: a política nega pela pasta da empresa
      const pol = await tx.query("select app.pode_ver($1::uuid) as pode", [c.B]);
      expect(pol.rows[0].pode).toBe(false);
    });
  });

  it("AT-011: ninguém pela tela lê o caminho do pfx nem a senha cifrada", async () => {
    await emTransacao(async (tx) => {
      const c = await cenario(tx);
      await tx.query(
        "insert into certificado (empresa_id, storage_path, pfx_cripto, senha_cripto, sha256, titular, valido_de, valido_ate, enviado_por) values ($1,'x','{}','{}',$2,'T',now(),now()+interval '1 year',$3)",
        [c.A, "f".repeat(64), c.u.escritorio],
      );
      for (const u of [c.u.userA, c.u.adminA, c.u.escritorio]) {
        await como(tx, "authenticated", u);
        expect(await recusa(tx, "select senha_cripto from certificado")).toBe("42501");
        expect(await recusa(tx, "select storage_path, pfx_cripto from certificado")).toBe("42501");
        const meta = await tx.query("select titular, valido_ate from certificado where empresa_id = $1", [c.A]);
        expect(meta.rowCount).toBe(1);
      }
    });
  });

  it("AT-014: usuário comum do cliente não cancela nem substitui; admin do cliente e escritório podem", async () => {
    await emTransacao(async (tx) => {
      const c = await cenario(tx);
      await como(tx, "service_role");
      const args = (quem: string) => [c.A, c.notaA, "cancelamento", "1", "Serviço não foi prestado ao tomador", quem];
      const sql = "select fn_registrar_evento($1,$2,$3,$4,$5,$6,null,null)";
      expect(await recusa(tx, sql, args(c.u.userA))).toBe("42501");
      expect(await recusa(tx, sql, args(c.u.userB))).toBe("42501");
      await tx.query("savepoint s");
      await tx.query(sql, args(c.u.adminA));
      expect((await tx.query("select situacao from nota where id = $1", [c.notaA])).rows[0].situacao).toBe("cancelada");
      // cliente cancelou ⇒ aviso ao escritório (AT-015)
      expect((await tx.query("select count(*)::int n from aviso where nota_id = $1 and tipo = 'cancelamento'", [c.notaA])).rows[0].n).toBe(1);
      await tx.query("rollback to savepoint s");
      await tx.query(sql, args(c.u.escritorio));
      // substituição pela fila: usuário comum não enfileira a nota substituta
      await como(tx, "authenticated", c.u.userA);
      const nova = await tx.query(
        "insert into nota (empresa_id, descricao, tomador_id, valor_servico, competencia, codigo_tributacao_nacional, cod_municipio_prestacao, nota_substituida_id, codigo_motivo_substituicao, motivo_substituicao) values ($1,'nova',$2,10,'2026-11-01','010601','4301602',$3,'99','Valor informado errado na nota') returning id",
        [c.A, c.tomA, c.notaB],
      ).catch((e) => e);
      expect(nova).toBeInstanceOf(Error); // nota de B: chave composta recusa
    });
  });

  it("AT-014 (substituição): usuário comum não enfileira; admin do cliente sim", async () => {
    await emTransacao(async (tx) => {
      const c = await cenario(tx);
      const inserir = async (u: string) => {
        await como(tx, "authenticated", u);
        const r = await tx.query(
          "insert into nota (empresa_id, descricao, tomador_id, valor_servico, competencia, codigo_tributacao_nacional, cod_municipio_prestacao, nota_substituida_id, codigo_motivo_substituicao, motivo_substituicao) values ($1,'nova',$2,10,'2026-11-01','010601','4301602',$3,'99','Valor informado errado na nota') returning id",
          [c.A, c.tomA, c.notaA],
        );
        return String(r.rows[0].id);
      };
      const deUser = await inserir(c.u.userA);
      expect(await recusa(tx, "update nota set situacao = 'na_fila' where id = $1", [deUser])).toBe("42501");
      const deAdmin = await inserir(c.u.adminA);
      await tx.query("update nota set situacao = 'na_fila' where id = $1", [deAdmin]);
    });
  });

  it("AT-026: admin do cliente cria usuário só na própria empresa (perfil coerente)", async () => {
    await emTransacao(async (tx) => {
      const c = await cenario(tx);
      await como(tx, "authenticated", c.u.adminA);
      const novo = tx.uuid();
      await como(tx, "postgres");
      await tx.query("insert into auth.users (id, email) values ($1, 'novo@teste.invalid')", [novo]);
      await como(tx, "authenticated", c.u.adminA);
      await recusa(tx, "insert into perfil_usuario (usuario_id, empresa_id, papel) values ($1, $2, 'cliente_usuario')", [novo, c.A]);
      await como(tx, "service_role");
      expect(await recusa(tx, "insert into perfil_usuario (usuario_id, empresa_id, papel) values ($1, null, 'cliente_usuario')", [novo])).toBe("23514");
      await como(tx, "postgres");
      expect((await tx.query("select app.usuario_pode_administrar($1, $2) ok", [c.u.adminA, c.B])).rows[0].ok).toBe(false);
      expect((await tx.query("select app.usuario_pode_administrar($1, $2) ok", [c.u.adminA, c.A])).rows[0].ok).toBe(true);
    });
  });
});
