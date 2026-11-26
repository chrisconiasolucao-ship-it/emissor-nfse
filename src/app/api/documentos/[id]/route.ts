import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ipDe, logSeguranca } from "@/lib/auditoria/audit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServidor } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Download de XML/DANFSe (AT-029, AT-032, AT-033): o documento é lido com a sessão do usuário (RLS
 * decide se ele vê), o SHA-256 do arquivo é conferido, o log de segurança é gravado e só então sai
 * uma URL assinada de 60 s.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ erro: "documento inválido" }, { status: 400 });
  const db = await supabaseServidor();
  const { data: u } = await db.auth.getUser();
  if (!u.user) return NextResponse.json({ erro: "faça login" }, { status: 401 });
  const admin = supabaseAdmin();
  const ip = ipDe(req.headers);

  const { data: doc } = await db.from("documento").select("empresa_id, id, tipo, storage_path, sha256, nome_original").eq("id", id).maybeSingle();
  if (!doc) {
    await logSeguranca(admin, { evento: "acesso_negado", usuarioId: u.user.id, email: u.user.email, ip, alvo: `documento:${id}` });
    return NextResponse.json({ erro: "documento não encontrado" }, { status: 404 });
  }
  // Storage não aceita trigger: confere o conteúdo contra o hash imutável do banco (G08)
  const arq = await admin.storage.from("documentos").download(doc.storage_path);
  if (arq.error || !arq.data) return NextResponse.json({ erro: "arquivo indisponível" }, { status: 502 });
  const hash = createHash("sha256").update(Buffer.from(await arq.data.arrayBuffer())).digest("hex");
  if (hash !== String(doc.sha256).trim()) {
    await admin.rpc("fn_avisar", { p_empresa_id: doc.empresa_id, p_tipo: "auditoria_quebrada", p_nota_id: null, p_mensagem: `Arquivo ${doc.storage_path} não confere com o SHA-256 gravado.`, p_quem: null });
    return NextResponse.json({ erro: "o arquivo não confere com o original e não foi entregue" }, { status: 409 });
  }
  await logSeguranca(admin, { evento: "download_documento", usuarioId: u.user.id, email: u.user.email, ip, empresaId: doc.empresa_id, alvo: `documento:${doc.id}`, detalhe: { tipo: doc.tipo } });
  const nome = doc.nome_original ?? `${doc.tipo}-${doc.id}.${doc.tipo === "danfse" ? "pdf" : "xml"}`;
  const { data: url, error } = await admin.storage.from("documentos").createSignedUrl(doc.storage_path, 60, { download: nome });
  if (error || !url) return NextResponse.json({ erro: "não gerou o link" }, { status: 500 });
  return NextResponse.redirect(url.signedUrl, 302);
}
