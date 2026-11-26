import { afterAll, describe, expect, it } from "vitest";
import { entrar, type PortasLogin } from "@/lib/auth/login";
import { como, emTransacao, fecharBanco, type Tx } from "./_db";

afterAll(fecharBanco);

function portas(tx: Tx, senhaCerta: string, relogio: { agora: Date }): PortasLogin {
  return {
    agora: () => relogio.agora,
    async bloqueadoAte(email) {
      const r = await tx.query("select fn_login_bloqueado_ate($1, 3, 15) ate", [email]);
      return r.rows[0].ate ? new Date(r.rows[0].ate) : null;
    },
    entrarComSenha: async (_e, s) => (s === senhaCerta ? { ok: true, usuarioId: "00000000-0000-4000-8000-000000000999" } : { ok: false }),
    sair: async () => undefined,
    registrarTentativa: async (email, ip, ok) => void (await tx.query("select fn_registrar_login($1, $2::inet, $3)", [email, ip, ok])),
    logSeguranca: async (e) =>
      void (await tx.query("select fn_log_seguranca($1, $2, $3, $4::inet, $5, $6, $7)", [e.evento, e.usuarioId ?? null, e.email ?? null, e.ip ?? null, e.empresaId ?? null, e.alvo ?? null, e.detalhe ?? null])),
  };
}

describe("login (AT-023, AT-033)", () => {
  it("3 senhas erradas bloqueiam por 15 min; cada falha e o bloqueio vão para o log de segurança", async () => {
    await emTransacao(async (tx) => {
      await como(tx, "service_role");
      const email = `bloqueio.${tx.uuid().slice(0, 8)}@teste.invalid`;
      const relogio = { agora: new Date() };
      const p = portas(tx, "certa", relogio);
      expect(await entrar(p, { email, senha: "x", ip: "10.0.0.1" })).toEqual({ ok: false, motivo: "credenciais" });
      expect(await entrar(p, { email, senha: "y", ip: "10.0.0.1" })).toEqual({ ok: false, motivo: "credenciais" });
      const terceira = await entrar(p, { email, senha: "z", ip: "10.0.0.1" });
      expect(terceira).toMatchObject({ ok: false, motivo: "bloqueado" });
      // nem a senha certa entra durante o bloqueio
      expect(await entrar(p, { email, senha: "certa", ip: "10.0.0.1" })).toMatchObject({ ok: false, motivo: "bloqueado" });
      const log = await tx.query("select evento, ip::text, email from log_seguranca where email = $1 order by id", [email]);
      expect(log.rows.map((r) => r.evento)).toEqual(["login_falha", "login_falha", "login_falha", "login_bloqueado", "login_bloqueado"]);
      expect(log.rows[0].ip).toBe("10.0.0.1/32");
      // 15 min depois libera sozinho
      if (terceira.ok === false && terceira.liberaEm) {
        await tx.query("update login_tentativa set quando = quando - interval '16 minutes' where email = $1", [email]);
        relogio.agora = new Date();
        expect(await entrar(p, { email, senha: "certa", ip: "10.0.0.1" })).toMatchObject({ ok: true });
        const ult = await tx.query("select evento from log_seguranca where email = $1 order by id desc limit 1", [email]);
        expect(ult.rows[0].evento).toBe("login_ok");
      }
    });
  });

  it("AT-033: se o log de segurança não grava, o login não conclui", async () => {
    await emTransacao(async (tx) => {
      await como(tx, "service_role");
      let saiu = false;
      const p = { ...portas(tx, "certa", { agora: new Date() }), sair: async () => void (saiu = true), logSeguranca: async () => { throw new Error("log fora"); } };
      await expect(entrar(p, { email: "a@teste.invalid", senha: "certa", ip: null })).rejects.toThrow("log fora");
      expect(saiu).toBe(true);
    });
  });
});
