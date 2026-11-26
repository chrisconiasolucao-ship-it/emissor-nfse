import { NextResponse } from "next/server";
import { segredoDoWorkerConfere } from "@/lib/auth/sessao";
import { aprenderDaNfse } from "@/lib/cadastros/aprender";
import { config } from "@/lib/config";
import { lerNfse } from "@/lib/nfse/nfse-parser";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Carga dos cadastros a partir do que já foi importado: lê os XMLs de origem (envio e ADN) e os XMLs
 * autorizados das notas emitidas, e cria os tomadores e serviços que faltam. Rodar de novo não duplica.
 * Opcional: ?empresa=<id>.
 */
export async function POST(req: Request) {
  const c = config();
  if (!segredoDoWorkerConfere(req.headers.get("x-worker-secret"), c.WORKER_SECRET)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const so = new URL(req.url).searchParams.get("empresa");
  let qe = db.from("empresa").select("id, cnpj").eq("ativa", true);
  if (so) qe = qe.eq("id", so);
  const { data: empresas, error } = await qe;
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  const saida: Record<string, unknown>[] = [];
  for (const e of empresas ?? []) {
    const r = { empresa: e.id, lidos: 0, tomadores: 0, servicos: 0, ignorados: 0, erros: [] as string[] };
    const { data: docs } = await db.from("documento").select("id, storage_path, tipo").eq("empresa_id", e.id)
      .in("tipo", ["xml_origem", "xml_autorizado"]).order("criado_em", { ascending: false }).limit(500);
    for (const d of docs ?? []) {
      try {
        const arq = await db.storage.from("documentos").download(String(d.storage_path));
        if (arq.error || !arq.data) throw new Error(`Storage: ${arq.error?.message}`);
        const a = await aprenderDaNfse(db, { id: e.id, cnpj: String(e.cnpj) }, lerNfse(await arq.data.text()), d.tipo === "xml_autorizado" ? "nota" : "xml");
        r.lidos++;
        if (a.tomador === "novo") r.tomadores++;
        if (a.servico === "novo") r.servicos++;
        if (a.servico === "sem") r.ignorados++;
      } catch (err) {
        if (r.erros.length < 5) r.erros.push(`${d.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    saida.push(r);
  }
  return NextResponse.json({ empresas: saida });
}
