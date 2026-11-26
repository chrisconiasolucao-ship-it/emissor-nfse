import { NextResponse } from "next/server";
import { auditar } from "@/lib/auditoria/audit";
import { segredoDoWorkerConfere } from "@/lib/auth/sessao";
import { catalogo } from "@/lib/catalogo";
import { config } from "@/lib/config";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Carrega (upsert) as tabelas de referência no banco. Idempotente: rodar de novo só atualiza descrições. */
export async function POST(req: Request) {
  const c = config();
  if (!segredoDoWorkerConfere(req.headers.get("x-worker-secret"), c.WORKER_SECRET)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const carregar = async (tabela: string, linhas: Record<string, string>[], chave: string) => {
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await db.from(tabela).upsert(linhas.slice(i, i + 500), { onConflict: chave });
      if (error) throw new Error(`${tabela}: ${error.message}`);
    }
    return linhas.length;
  };
  try {
    const r = {
      cod_tributacao_nacional: await carregar("cod_tributacao_nacional", catalogo.servicos.map(([codigo, descricao]) => ({ codigo, descricao })), "codigo"),
      nbs: await carregar("nbs", catalogo.nbs.map(([codigo, descricao]) => ({ codigo, descricao })), "codigo"),
      ind_operacao: await carregar("ind_operacao", catalogo.indop.map(([codigo, descricao]) => ({ codigo, descricao })), "codigo"),
      correlacao_item_nbs: await carregar("correlacao_item_nbs", catalogo.correlacao.map(([item, nbs, ind_op, cclasstrib]) => ({ item, nbs, ind_op, cclasstrib })), "item,nbs"),
    };
    await auditar(db, { empresaId: null, acao: "carregar_catalogo", entidade: "catalogo", entidadeId: null, depois: r, quem: null });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ erro: String(e) }, { status: 500 });
  }
}
