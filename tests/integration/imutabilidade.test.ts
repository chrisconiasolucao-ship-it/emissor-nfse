import { afterAll, describe, expect, it } from "vitest";
import { cenario, como, emTransacao, fecharBanco, recusa } from "./_db";

afterAll(fecharBanco);

describe("imutabilidade (AT-016, AT-027, AT-028, AT-029)", () => {
  it("AT-027: nota autorizada não muda nem some, nem pelo service role", async () => {
    await emTransacao(async (tx) => {
      const c = await cenario(tx);
      for (const p of ["service_role", "postgres"] as const) {
        await como(tx, p);
        expect(await recusa(tx, "update nota set valor_servico = 1 where id = $1", [c.notaA])).toBe("P0001");
        expect(await recusa(tx, "update nota set situacao = 'cancelada' where id = $1", [c.notaA])).toBe("P0001");
        expect(await recusa(tx, "delete from nota where id = $1", [c.notaA])).toBe("P0001");
      }
    });
  });

  it("AT-016: cancelamento sem motivo (ou com menos de 15 letras) é recusado", async () => {
    await emTransacao(async (tx) => {
      const c = await cenario(tx);
      await como(tx, "service_role");
      for (const m of [null, "", "curto demais"]) {
        expect(await recusa(tx, "select fn_registrar_evento($1,$2,'cancelamento','1',$3,$4,null,null)", [c.A, c.notaA, m, c.u.escritorio])).toBe("23514");
      }
    });
  });

  it("AT-028: trilha de auditoria e log de segurança só aceitam acréscimo", async () => {
    await emTransacao(async (tx) => {
      const c = await cenario(tx);
      await como(tx, "service_role");
      await tx.query("select fn_auditar($1,'teste','nota',$2,null,'{}'::jsonb)", [c.A, c.notaA]);
      await tx.query("select fn_log_seguranca('exportacao',null,null,null,$1,'teste')", [c.A]);
      for (const p of ["service_role", "postgres"] as const) {
        await como(tx, p);
        for (const t of ["auditoria", "log_seguranca"]) {
          await recusa(tx, `update ${t} set empresa_id = null where empresa_id = $1`, [c.A]);
          await recusa(tx, `delete from ${t} where empresa_id = $1`, [c.A]);
        }
        await recusa(tx, "truncate auditoria");
      }
      await como(tx, "authenticated", c.u.escritorio);
      expect(await recusa(tx, "insert into auditoria (acao, entidade) values ('x','y')")).toBe("42501");
    });
  });

  it("AT-029: documento-fonte não troca de hash nem de caminho, e o SHA-256 é único por empresa", async () => {
    await emTransacao(async (tx) => {
      const c = await cenario(tx);
      await como(tx, "service_role");
      await recusa(tx, "update documento set sha256 = $1 where id = $2", ["0".repeat(64), c.docA]);
      await recusa(tx, "update documento set storage_path = 'outro' where id = $1", [c.docA]);
      await recusa(tx, "delete from documento where id = $1", [c.docA]);
      expect(await recusa(tx, "insert into documento (empresa_id, tipo, storage_path, sha256, tamanho, content_type) values ($1,'xml_autorizado','z',$2,1,'x')", [c.A, "a".repeat(64)])).toBe("23505");
    });
  });
});
