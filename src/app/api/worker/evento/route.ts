import { NextResponse } from "next/server";
import { z } from "zod";
import { auditar, logSeguranca } from "@/lib/auditoria/audit";
import { segredoDoWorkerConfere } from "@/lib/auth/sessao";
import { config } from "@/lib/config";
import { cancelarNaReceita } from "@/lib/fila/cancelamento";
import { abrirCertificadoDaEmpresa } from "@/lib/fila/portas-supabase";
import { CAMINHOS, SefinClient, agenteMtls, transporteHttps } from "@/lib/nfse/sefin-client";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const entrada = z.object({
  nota: z.uuid(),
  modo: z.enum(["consultar", "cancelar"]),
  quem: z.uuid().optional(),
  codigo_motivo: z.enum(["1", "2", "9"]).optional(),
  motivo: z.string().trim().min(15).max(255).optional(),
});

/**
 * Manutenção de eventos (só produção restrita, exige o segredo do worker):
 * - consultar: lê na Sefin a NFS-e e os eventos da nota (sem efeito), devolvendo status e corpo;
 * - cancelar: faz o mesmo cancelamento da tela, em nome de `quem` (o banco confere a permissão).
 */
export async function POST(req: Request) {
  const c = config();
  if (!segredoDoWorkerConfere(req.headers.get("x-worker-secret"), c.WORKER_SECRET)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  if (c.NFSE_AMBIENTE !== "restrita") return NextResponse.json({ erro: "só na produção restrita" }, { status: 400 });
  const r = entrada.safeParse(await req.json().catch(() => ({})));
  if (!r.success) return NextResponse.json({ erro: r.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  const d = r.data;
  const admin = supabaseAdmin();
  const { data: nota } = await admin.from("nota").select("empresa_id, chave_acesso, situacao").eq("id", d.nota).single();
  if (!nota?.chave_acesso) return NextResponse.json({ erro: "nota sem chave de acesso" }, { status: 404 });
  const empresaId = String(nota.empresa_id);
  const cert = await abrirCertificadoDaEmpresa(admin, empresaId);
  await logSeguranca(admin, { evento: "uso_certificado", usuarioId: d.quem ?? null, email: null, ip: null, empresaId, alvo: d.nota, detalhe: { acao: `worker_evento_${d.modo}` } });

  if (d.modo === "consultar") {
    const sefin = new SefinClient(c.SEFIN_BASE_URL, transporteHttps(agenteMtls(cert.pfx, cert.senha)));
    const chave = String(nota.chave_acesso);
    const eventos = await sefin.diagnosticar("GET", CAMINHOS.eventos(chave));
    const cancel = await sefin.diagnosticar("GET", `${CAMINHOS.eventos(chave)}/101101`);
    const nfse = await sefin.diagnosticar("GET", CAMINHOS.nfse(chave));
    return NextResponse.json({ situacao: nota.situacao, eventos, cancelamento: cancel, nfse: { status: nfse.status, contentType: nfse.contentType, inicio: nfse.corpo.slice(0, 200) } });
  }

  if (!d.quem || !d.codigo_motivo || !d.motivo) return NextResponse.json({ erro: "cancelar exige quem, codigo_motivo e motivo" }, { status: 400 });
  await auditar(admin, { empresaId, acao: "uso_certificado", entidade: "nota", entidadeId: d.nota, depois: { acao: "cancelamento", certificado_sha256: cert.aberto.sha256 }, quem: d.quem, ip: null });
  const res = await cancelarNaReceita(admin, { empresaId, notaId: d.nota, codigoMotivo: d.codigo_motivo, motivo: d.motivo, quem: d.quem, ip: null });
  return NextResponse.json(res);
}
