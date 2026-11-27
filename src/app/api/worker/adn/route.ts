import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auditar } from "@/lib/auditoria/audit";
import { segredoDoWorkerConfere } from "@/lib/auth/sessao";
import { config } from "@/lib/config";
import { abrirCertificadoDaEmpresa } from "@/lib/fila/portas-supabase";
import { sha256 } from "@/lib/importacao/planilha";
import { AdnClient } from "@/lib/nfse/adn-client";
import { lerNfse, type ModeloNota } from "@/lib/nfse/nfse-parser";
import { inserirComResumo, resumoDaNfse } from "@/lib/nfse/resumo-documento";
import { aprenderDaNfse } from "@/lib/cadastros/aprender";
import { agenteMtls, transporteHttps } from "@/lib/nfse/sefin-client";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Busca no ADN as notas emitidas para/por cada empresa (AT-019, AT-021). Guarda o XML como documento
 * de origem (SHA-256 único: rodar duas vezes não duplica, AT-031) para servir de modelo.
 * Pode ser chamada pelo pg_cron (1x/dia) ou pela tela Importar com ?empresa=<id>.
 */
export async function POST(req: Request) {
  const c = config();
  if (!segredoDoWorkerConfere(req.headers.get("x-worker-secret"), c.WORKER_SECRET)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const dono = randomUUID();
  const { data: pegou } = await db.rpc("fn_adquirir_lease", { p_nome: "adn", p_segundos: 290, p_dono: dono });
  if (!pegou) return NextResponse.json({ ocupado: true });
  const so = new URL(req.url).searchParams.get("empresa");
  const relatorio: Record<string, unknown>[] = [];
  try {
    let q = db.from("empresa").select("id, cnpj").eq("ativa", true).eq("pausada", false);
    if (so) q = q.eq("id", so);
    const { data: empresas, error } = await q;
    if (error) throw new Error(error.message);
    for (const e of empresas ?? []) {
      try {
        const cert = await abrirCertificadoDaEmpresa(db, e.id);
        const adn = new AdnClient(c.ADN_BASE_URL, transporteHttps(agenteMtls(cert.pfx, cert.senha)));
        const { data: cur } = await db.from("adn_cursor").select("ultimo_nsu").eq("empresa_id", e.id).maybeSingle();
        let nsu = BigInt(String(cur?.ultimo_nsu ?? 0));
        let novos = 0;
        let repetidos = 0;
        const cadastros = { tomadores: 0, servicos: 0 };
        for await (const d of adn.todos(e.cnpj, nsu)) {
          nsu = d.nsu > nsu ? d.nsu : nsu;
          if (!/NFSE/i.test(d.tipo)) continue;
          const xml = Buffer.from(d.xml, "utf8");
          const hash = sha256(xml);
          const caminho = `${e.id}/adn/${hash}.xml`;
          const up = await db.storage.from("documentos").upload(caminho, xml, { contentType: "application/xml", upsert: false });
          if (up.error && !/exists|duplicate/i.test(up.error.message)) throw new Error(`Storage: ${up.error.message}`);
          let modelo: ModeloNota | null = null;
          try { modelo = lerNfse(d.xml); } catch { /* XML fora do padrão fica guardado, mas não aparece como modelo */ }
          const base = { empresa_id: e.id, tipo: "xml_origem", storage_path: caminho, sha256: hash, tamanho: xml.length, content_type: "application/xml", nome_original: d.chaveAcesso ? `${d.chaveAcesso}.xml` : null };
          const ins = await inserirComResumo((l) => db.from("documento").insert(l), base, modelo ? resumoDaNfse(modelo, e.cnpj) : null);
          if (ins.error?.code === "23505") repetidos++;
          else if (ins.error) throw new Error(ins.error.message);
          else {
            novos++;
            if (modelo) try {
              // nota emitida pela empresa alimenta os cadastros de tomadores e serviços (nunca sobrescreve)
              const a = await aprenderDaNfse(db, { id: e.id, cnpj: e.cnpj }, modelo, "adn");
              if (a.tomador === "novo") cadastros.tomadores++;
              if (a.servico === "novo") cadastros.servicos++;
            } catch {
              /* XML fora do padrão fica guardado, mas não aparece como modelo */
            }
          }
        }
        await db.from("adn_cursor").upsert({ empresa_id: e.id, ultimo_nsu: nsu.toString(), atualizado_em: new Date().toISOString() });
        await auditar(db, { empresaId: e.id, acao: "consulta_adn", entidade: "empresa", entidadeId: e.id, depois: { ultimo_nsu: nsu.toString(), novos, repetidos, cadastros } });
        relatorio.push({ empresa: e.id, novos, repetidos, cadastros, ultimoNsu: nsu.toString() });
      } catch (err) {
        relatorio.push({ empresa: e.id, erro: err instanceof Error ? err.message : String(err) });
      }
    }
    return NextResponse.json({ empresas: relatorio });
  } finally {
    await db.rpc("fn_liberar_lease", { p_nome: "adn", p_dono: dono });
  }
}
