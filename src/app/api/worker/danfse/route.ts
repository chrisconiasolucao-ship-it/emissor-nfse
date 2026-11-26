import { NextResponse } from "next/server";
import { segredoDoWorkerConfere } from "@/lib/auth/sessao";
import { config } from "@/lib/config";
import { portasSupabase } from "@/lib/fila/portas-supabase";
import { gerarDanfse } from "@/lib/nfse/danfse";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * DANFSe gerado depois: para notas autorizadas sem PDF guardado, gera o DANFSe (NT 008) a partir do XML
 * autorizado que está no Storage e guarda como documento da nota (a nota em si não muda).
 */
export async function POST(req: Request) {
  const c = config();
  if (!segredoDoWorkerConfere(req.headers.get("x-worker-secret"), c.WORKER_SECRET)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const portas = portasSupabase(db, "danfse");
  const { data: notas, error } = await db.from("nota").select("id, empresa_id, documento_id")
    .eq("situacao", "autorizada").is("danfse_documento_id", null).not("documento_id", "is", null)
    .order("autorizada_em", { ascending: false }).limit(20);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  const saida: { nota: string; documento?: string; erro?: string }[] = [];
  for (const n of notas ?? []) {
    const ja = await db.from("documento").select("id").eq("empresa_id", n.empresa_id).eq("tipo", "danfse").eq("nota_id", n.id).limit(1);
    if (ja.data?.length) continue;
    try {
      const { data: doc } = await db.from("documento").select("storage_path").eq("empresa_id", n.empresa_id).eq("id", n.documento_id).single();
      if (!doc) throw new Error("XML autorizado não encontrado");
      const arq = await db.storage.from("documentos").download(String(doc.storage_path));
      if (arq.error || !arq.data) throw new Error(`Storage: ${arq.error?.message}`);
      const pdf = await gerarDanfse(await arq.data.text(), { nomeMunicipio: portas.nomeMunicipio });
      const id = await portas.guardarDocumento({ empresaId: String(n.empresa_id), id: String(n.id) } as never, "danfse", pdf, "application/pdf");
      saida.push({ nota: String(n.id), documento: id });
    } catch (e) {
      saida.push({ nota: String(n.id), erro: e instanceof Error ? e.message : String(e) });
    }
  }
  console.info(JSON.stringify({ worker: "danfse", saida }));
  return NextResponse.json({ saida });
}
