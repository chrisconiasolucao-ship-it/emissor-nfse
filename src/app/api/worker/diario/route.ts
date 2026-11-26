import { NextResponse } from "next/server";
import { armazemVercelBlob, gravarAncoraDoDia, lerAncoras } from "@/lib/auditoria/ancora";
import { descreverQuebra, verificarCadeia } from "@/lib/auditoria/verificador";
import { segredoDoWorkerConfere } from "@/lib/auth/sessao";
import { config } from "@/lib/config";
import { alertaDeVencimento, diasParaVencer } from "@/lib/crypto/pfx";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const hojeBrasilia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/** Rotina diária (Decision 7; AT-025, AT-033, AT-034). Cada parte roda mesmo se outra falhar. */
export async function POST(req: Request) {
  const c = config();
  if (!segredoDoWorkerConfere(req.headers.get("x-worker-secret"), c.WORKER_SECRET)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const saida: Record<string, unknown> = {};
  const avisar = (empresa: string | null, tipo: string, mensagem: string) =>
    db.rpc("fn_avisar", { p_empresa_id: empresa, p_tipo: tipo, p_nota_id: null, p_mensagem: mensagem, p_quem: null });

  // 1. certificados vencendo: aviso aos 30 e aos 15 dias, uma vez cada (AT-025)
  try {
    const { data: certs } = await db.from("certificado").select("empresa_id, id, titular, valido_ate, alerta_30_em, alerta_15_em").eq("ativo", true);
    let avisos = 0;
    for (const k of certs ?? []) {
      const dias = diasParaVencer(new Date(k.valido_ate));
      const campo = alertaDeVencimento(
        { validoAte: new Date(k.valido_ate), alerta30Em: k.alerta_30_em ? new Date(k.alerta_30_em) : null, alerta15Em: k.alerta_15_em ? new Date(k.alerta_15_em) : null },
        c.CERT_ALERTA_DIAS,
      );
      if (!campo) continue;
      await avisar(k.empresa_id, "certificado_vencendo", `Certificado de ${k.titular} vence em ${dias} dia(s) (${String(k.valido_ate).slice(0, 10)}).`);
      await db.from("certificado").update({ [campo]: new Date().toISOString() }).eq("empresa_id", k.empresa_id).eq("id", k.id);
      avisos++;
    }
    saida.certificados = { avisos };
  } catch (e) {
    saida.certificados = { erro: String(e) };
  }

  // 2. municípios desatualizados (Decision 8)
  try {
    const { data: m } = await db.from("municipio_situacao").select("importado_em").order("importado_em", { ascending: false }).limit(1).maybeSingle();
    const dias = m ? Math.floor((Date.now() - new Date(m.importado_em).getTime()) / 86_400_000) : null;
    if (dias === null || dias > c.MUNICIPIOS_ALERTA_DIAS) {
      await avisar(null, "municipios_desatualizados", "A situação dos municípios não é atualizada há mais de 30 dias. Importe o painel da Receita.");
    }
    saida.municipios = { diasDesdeImportacao: dias };
  } catch (e) {
    saida.municipios = { erro: String(e) };
  }

  // 3. âncora e cópia do log fora do banco; 4. verificador contra as âncoras do Blob
  if (!c.BLOB_READ_WRITE_TOKEN) {
    await avisar(null, "falha_copia", "BLOB_READ_WRITE_TOKEN não configurado: a âncora e a cópia do log de hoje não foram gravadas.");
    saida.ancora = { erro: "sem BLOB_READ_WRITE_TOKEN" };
  } else {
    const armazem = armazemVercelBlob(c.BLOB_READ_WRITE_TOKEN);
    try {
      saida.ancora = (await gravarAncoraDoDia(db, armazem, hojeBrasilia())) ?? "já gravada hoje";
    } catch (e) {
      await avisar(null, "falha_copia", `Falha ao gravar a âncora/cópia do log de hoje: ${String(e)}. Nova tentativa amanhã.`);
      saida.ancora = { erro: String(e) };
    }
    try {
      const r = await verificarCadeia(db, await lerAncoras(armazem));
      for (const q of r.quebras) await avisar(null, "auditoria_quebrada", descreverQuebra(q));
      saida.verificador = r;
    } catch (e) {
      saida.verificador = { erro: String(e) };
    }
  }
  console.info(JSON.stringify({ worker: "diario", ...saida }));
  return NextResponse.json(saida);
}
