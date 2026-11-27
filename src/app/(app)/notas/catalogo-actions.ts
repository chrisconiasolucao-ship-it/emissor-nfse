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

export type OpcoesIbsCbs = {
  /** correlação oficial para o código + NBS (vazia quando não há NBS ou correlação) */
  correlacao: { indOp: string; cClassTrib: string }[];
  cclasstrib: Opcao[];
  indop: Opcao[];
  atividades: Opcao[];
};

/** Listas do IBS/CBS para o cadastro do serviço (NT 009). Sem a correlação, mostra as tabelas inteiras. */
export async function opcoesIbsCbs(codTribNac: string, nbs: string): Promise<OpcoesIbsCbs> {
  const db = await supabaseServidor();
  let correlacao: OpcoesIbsCbs["correlacao"] = [];
  if (/^\d{6}$/.test(codTribNac) && /^\d{9}$/.test(nbs)) {
    const { data } = await db.from("correlacao_ibscbs").select("ind_op, cclasstrib").in("item", itensDoCodigo(codTribNac)).eq("nbs", nbs);
    correlacao = (data ?? []).map((c) => ({ indOp: String(c.ind_op), cClassTrib: String(c.cclasstrib) }));
  }
  const [cc, io, at] = await Promise.all([
    db.from("cclasstrib").select("codigo, nome").order("codigo"),
    db.from("indop_ibscbs").select("codigo, local_incidencia, tipo_operacao").order("codigo"),
    db.from("atividade_simples").select("codigo, anexo, descricao").order("codigo"),
  ]);
  return {
    correlacao,
    cclasstrib: (cc.data ?? []).map((c) => ({ codigo: String(c.codigo), descricao: String(c.nome) })),
    indop: (io.data ?? []).map((c) => ({ codigo: String(c.codigo), descricao: `${String(c.tipo_operacao)} · ${String(c.local_incidencia)}` })),
    atividades: (at.data ?? []).map((c) => ({ codigo: String(c.codigo), descricao: `Anexo ${String(c.anexo)} · ${String(c.descricao)}` })),
  };
}
