import "server-only";
import { timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { supabaseServidor } from "@/lib/supabase/server";
import type { Perfil } from "./permissoes";

/** Perfil do usuário logado, lido com a sessão dele (RLS). Sem sessão ou perfil inativo ⇒ login. */
export async function perfilAtual(): Promise<Perfil & { email: string | null; nome: string | null }> {
  const db = await supabaseServidor();
  const { data: u } = await db.auth.getUser();
  if (!u.user) redirect("/login");
  const { data } = await db.from("perfil_usuario").select("usuario_id, papel, empresa_id, ativo, email, nome").eq("usuario_id", u.user.id).maybeSingle();
  if (!data || !data.ativo) redirect("/login?motivo=perfil");
  return { usuarioId: data.usuario_id, papel: data.papel, empresaId: data.empresa_id, ativo: data.ativo, email: data.email, nome: data.nome };
}

/** Rotas chamadas pelo pg_cron: segredo no cabeçalho, comparado em tempo constante. */
export function segredoDoWorkerConfere(recebido: string | null, esperado: string): boolean {
  if (!recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}
