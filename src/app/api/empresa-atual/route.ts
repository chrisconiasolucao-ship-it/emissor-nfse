import { NextResponse, type NextRequest } from "next/server";
import { eEscritorio } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { COOKIE_EMPRESA } from "@/lib/empresa-atual";
import { supabaseServidor } from "@/lib/supabase/server";

/**
 * Abre uma empresa para o escritório trabalhar nela (?id=...) ou volta à lista (sem id).
 * `para` é a tela de destino, sempre um caminho interno.
 */
export async function GET(req: NextRequest) {
  const perfil = await perfilAtual();
  const id = req.nextUrl.searchParams.get("id");
  const para = req.nextUrl.searchParams.get("para") ?? "";
  const destino = /^\/(?!\/)[\w\-/?=&.%]*$/.test(para) ? para : id ? "/painel" : "/empresas";
  const res = NextResponse.redirect(new URL(destino, req.nextUrl.origin));
  if (!eEscritorio(perfil)) return res;
  if (!id) {
    res.cookies.delete(COOKIE_EMPRESA);
    return res;
  }
  const db = await supabaseServidor();
  const { data } = await db.from("empresa").select("id").eq("id", id).eq("ativa", true).maybeSingle();
  if (!data) return NextResponse.redirect(new URL("/empresas", req.nextUrl.origin));
  res.cookies.set(COOKIE_EMPRESA, data.id, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
