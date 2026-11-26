import { afterAll, describe, expect, it } from "vitest";
import { compararComAncoras } from "@/lib/auditoria/verificador";
import { alertaDeVencimento } from "@/lib/crypto/pfx";
import { cenario, como, emTransacao, fecharBanco } from "./_db";

afterAll(fecharBanco);

const dia = 86_400_000;

describe("rotina diária (AT-025, AT-034, âncora)", () => {
  it("AT-025: alerta aos 30 dias e de novo aos 15, uma vez cada", () => {
    const agora = new Date("2026-11-26T12:00:00Z");
    const em = (d: number) => new Date(agora.getTime() + d * dia + 3_600_000);
    expect(alertaDeVencimento({ validoAte: em(45), alerta30Em: null, alerta15Em: null }, [30, 15], agora)).toBeNull();
    expect(alertaDeVencimento({ validoAte: em(30), alerta30Em: null, alerta15Em: null }, [30, 15], agora)).toBe("alerta_30_em");
    expect(alertaDeVencimento({ validoAte: em(29), alerta30Em: agora, alerta15Em: null }, [30, 15], agora)).toBeNull();
    expect(alertaDeVencimento({ validoAte: em(15), alerta30Em: agora, alerta15Em: null }, [30, 15], agora)).toBe("alerta_15_em");
    expect(alertaDeVencimento({ validoAte: em(10), alerta30Em: agora, alerta15Em: agora }, [30, 15], agora)).toBeNull();
  });

  it("AT-034: o verificador aponta a linha alterada e a âncora de fora pega a cadeia reescrita", async () => {
    await emTransacao(async (tx) => {
      const c = await cenario(tx);
      await como(tx, "service_role");
      // só a parte da cadeia criada aqui: o branch `teste` pode ter histórico de outras provas
      const ids: number[] = [];
      for (let i = 0; i < 3; i++) ids.push(Number((await tx.query("select fn_auditar($1,'teste','nota',$2,null,$3::jsonb) id", [c.A, c.notaA, JSON.stringify({ i })])).rows[0].id));
      const integra = (await tx.query("select * from fn_verificar_auditoria($1)", [ids[0]])).rows[0];
      expect(integra.primeira_quebra).toBeNull();
      // âncora do "dia" guardada fora do banco: id e hash da linha do meio
      const ancorada = (await tx.query("select id, hash from auditoria where id = $1", [ids[1]])).rows[0];
      const ancora = { dia: "2026-11-25", ultimoId: Number(ancorada.id), hash: String(ancorada.hash) };

      // 1) alguém com acesso de dono altera uma linha antiga, por baixo das travas
      await como(tx, "postgres");
      await tx.query("savepoint adulterar");
      await tx.query("alter table auditoria disable trigger user");
      await tx.query("update auditoria set depois = '{\"i\": 99}' where id = $1", [ids[0]]);
      await tx.query("alter table auditoria enable trigger user");
      const quebra = (await tx.query("select * from fn_verificar_auditoria($1)", [ids[0]])).rows[0];
      expect(Number(quebra.primeira_quebra)).toBe(ids[0]);

      // 2) e se reescrever a cadeia inteira recalculando os hashes? o banco não vê; a âncora vê
      await tx.query("alter table auditoria disable trigger user");
      await tx.query(`
        do $$ declare r record; v_ant text;
        begin
          select hash into v_ant from auditoria where id < (select min(id) from auditoria where entidade = 'nota' and acao = 'teste') order by id desc limit 1;
          for r in select * from auditoria where id >= (select min(id) from auditoria where entidade = 'nota' and acao = 'teste') order by id loop
            update auditoria set hash_anterior = v_ant, hash = app.auditoria_hash(v_ant, (select a from auditoria a where a.id = r.id)) where id = r.id
              returning hash into v_ant;
          end loop;
        end $$`);
      await tx.query("alter table auditoria enable trigger user");
      const banco = (await tx.query("select * from fn_verificar_auditoria($1)", [ids[0]])).rows[0];
      expect(banco.primeira_quebra).toBeNull();
      const linhas = new Map<number, string>((await tx.query("select id, hash from auditoria where id = $1", [ancora.ultimoId])).rows.map((r) => [Number(r.id), String(r.hash)]));
      const r = compararComAncoras({ primeiraQuebra: null, ultimoId: Number(banco.ultimo_id), ultimoHash: banco.ultimo_hash }, [ancora], linhas);
      expect(r.integra).toBe(false);
      expect(r.quebras[0]).toMatchObject({ tipo: "ancora_diverge", linha: ancora.ultimoId });
      await tx.query("rollback to savepoint adulterar");
    });
  });
});
