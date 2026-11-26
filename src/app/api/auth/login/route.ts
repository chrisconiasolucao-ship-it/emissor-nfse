import { NextResponse } from "next/server";
import { z } from "zod";
import { ipDe, logSeguranca } from "@/lib/auditoria/audit";
import { entrar, mensagemLogin } from "@/lib/auth/login";
import { config } from "@/lib/config";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServidor } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corpo = z.object({ email: z.email(), senha: z.string().min(1).max(200) });

/** Único caminho de login (Decision 10): bloqueio de 3 falhas/15 min e log de segurança. */
export async function POST(req: Request) {
  const c = config();
  const r = corpo.safeParse(await req.json().catch(() => null));
  if (!r.success) return NextResponse.json({ erro: "Informe e-mail e senha." }, { status: 400 });
  const admin = supabaseAdmin();
  const sessao = await supabaseServidor();
  const resultado = await entrar(
    {
      agora: () => new Date(),
      async bloqueadoAte(email) {
        const { data, error } = await admin.rpc("fn_login_bloqueado_ate", { p_email: email, p_max: c.LOGIN_MAX_FALHAS, p_minutos: c.LOGIN_BLOQUEIO_MIN });
        if (error) throw new Error(error.message);
        return data ? new Date(data as string) : null;
      },
      async entrarComSenha(email, senha) {
        const { data, error } = await sessao.auth.signInWithPassword({ email, password: senha });
        return error || !data.user ? { ok: false } : { ok: true, usuarioId: data.user.id };
      },
      sair: async () => void (await sessao.auth.signOut()),
      async registrarTentativa(email, ip, sucesso) {
        const { error } = await admin.rpc("fn_registrar_login", { p_email: email, p_ip: ip, p_sucesso: sucesso });
        if (error) throw new Error(error.message);
      },
      logSeguranca: async (ev) => void (await logSeguranca(admin, ev)),
    },
    { email: r.data.email, senha: r.data.senha, ip: ipDe(req.headers) },
  );
  if (resultado.ok) return NextResponse.json({ ok: true });
  return NextResponse.json({ erro: mensagemLogin(resultado) }, { status: resultado.motivo === "bloqueado" ? 429 : 401 });
}
