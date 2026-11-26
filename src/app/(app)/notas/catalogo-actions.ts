"use server";

import { itensDoCodigo } from "@/lib/catalogo";
import { supabaseServidor } from "@/lib/supabase/server";

export type Opcao = { codigo: string; descricao: string };

/** Código de tributação nacional por código (início) ou por palavra da descrição. */
export async function buscarCodigosTributacao(termo: string): Promise<Opcao[]> {
  const t = String(termo ?? "").trim().replace(/[%_,()]/g, "");
  if (t.length < 2) return [];
  const db = await supabaseServidor();
  const q = db.from("cod_tributacao_nacional").select("codigo, descricao").order("codigo").limit(30);
  const dig = t.replace(/\D/g, "");
  const { data } = /^\d[\d.]*$/.test(t) ? await q.like("codigo", `${dig}%`) : await q.ilike("descricao", `%${t}%`);
  return data ?? [];
}

/** NBS aceitas para o código de tributação (correlação item × NBS). */
export async function nbsDoCodigo(codTribNac: string): Promise<Opcao[]> {
  if (!/^\d{6}$/.test(codTribNac)) return [];
  const db = await supabaseServidor();
  const { data } = await db.from("correlacao_item_nbs").select("nbs, nbs_ref:nbs(descricao)").in("item", itensDoCodigo(codTribNac)).order("nbs");
  return (data ?? []).map((l) => ({ codigo: l.nbs, descricao: String((l.nbs_ref as unknown as { descricao?: string } | null)?.descricao ?? "") }));
}

export async function descricaoCodigo(tabela: "cod_tributacao_nacional" | "nbs", codigo: string): Promise<string | null> {
  if (!/^\d{6,9}$/.test(codigo)) return null;
  const db = await supabaseServidor();
  const { data } = await db.from(tabela).select("descricao").eq("codigo", codigo).maybeSingle();
  return data?.descricao ?? null;
}
