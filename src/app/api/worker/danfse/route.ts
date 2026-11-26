import { NextResponse } from "next/server";
import { segredoDoWorkerConfere } from "@/lib/auth/sessao";
import { config } from "@/lib/config";
import { abrirCertificadoDaEmpresa, portasSupabase } from "@/lib/fila/portas-supabase";
import { agenteMtls, transporteHttps } from "@/lib/nfse/sefin-client";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * DANFSe baixado depois: para notas autorizadas sem PDF guardado, tenta os endereços conhecidos da API de DANFSe
 * (com o certificado da empresa) e guarda o primeiro PDF. Devolve o status de cada tentativa, para diagnóstico.
 */
export async function POST(req: Request) {
  const c = config();
  if (!segredoDoWorkerConfere(req.headers.get("x-worker-secret"), c.WORKER_SECRET)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const portas = portasSupabase(db, "danfse");
  const { data: notas, error } = await db.from("nota").select("id, empresa_id, chave_acesso")
    .eq("situacao", "autorizada").is("danfse_documento_id", null).not("chave_acesso", "is", null)
    .order("autorizada_em", { ascending: false }).limit(5);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  const saida = [];
  for (const n of notas ?? []) {
    const ja = await db.from("documento").select("id").eq("empresa_id", n.empresa_id).eq("tipo", "danfse").eq("nota_id", n.id).limit(1);
    if (ja.data?.length) continue;
    const chave = String(n.chave_acesso);
    const candidatos = [
      `${new URL(c.ADN_BASE_URL).origin}/danfse/${chave}`,
      `${c.ADN_BASE_URL}/danfse/${chave}`,
      `${c.SEFIN_BASE_URL}/danfse/${chave}`,
    ];
    const tentativas: { url: string; status: number | string; tipo?: string }[] = [];
    let documento: string | null = null;
    try {
      const cert = await abrirCertificadoDaEmpresa(db, String(n.empresa_id));
      const transporte = transporteHttps(agenteMtls(cert.pfx, cert.senha));
      for (const url of candidatos) {
        try {
          const r = await transporte({ metodo: "GET", url, timeoutMs: 20_000 });
          tentativas.push({ url, status: r.status, tipo: r.contentType });
          if (r.status >= 200 && r.status < 300 && r.contentType.includes("pdf")) {
            documento = await portas.guardarDocumento({ empresaId: String(n.empresa_id), id: String(n.id) } as never, "danfse", r.corpo, "application/pdf");
            break;
          }
        } catch (e) {
          tentativas.push({ url, status: e instanceof Error ? e.message : String(e) });
        }
      }
    } catch (e) {
      tentativas.push({ url: "certificado", status: e instanceof Error ? e.message : String(e) });
    }
    saida.push({ nota: n.id, documento, tentativas });
  }
  console.info(JSON.stringify({ worker: "danfse", saida }));
  return NextResponse.json({ saida });
}
