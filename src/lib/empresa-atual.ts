import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { eEscritorio, type Perfil } from "@/lib/auth/permissoes";
import { supabaseServidor } from "@/lib/supabase/server";

/** Cookie com a empresa aberta pelo escritório (só preferência de tela; o acesso continua no RLS). */
export const COOKIE_EMPRESA = "empresa_atual";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EmpresaAtual = { id: string; razao_social: string; cnpj: string; regime: string; pausada: boolean; motivo_pausa: string | null };

/**
 * A empresa em que o usuário está trabalhando: a escolhida na lista de empresas (escritório) ou a dele (cliente).
 * Empresa desativada ou fora do alcance do usuário conta como nenhuma.
 */
export const empresaAtual = cache(async (perfil: Perfil): Promise<EmpresaAtual | null> => {
  const id = eEscritorio(perfil) ? (await cookies()).get(COOKIE_EMPRESA)?.value : perfil.empresaId;
  if (!id || !UUID.test(id)) return null;
  const db = await supabaseServidor();
  const { data } = await db.from("empresa").select("id, razao_social, cnpj, regime, pausada, motivo_pausa").eq("id", id).eq("ativa", true).maybeSingle();
  return (data as EmpresaAtual | null) ?? null;
});
