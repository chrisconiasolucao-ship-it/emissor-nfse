import { NextResponse } from "next/server";
import { ipDe, logSeguranca } from "@/lib/auditoria/audit";
import { ArquivoAlterado, arquivosDaNota, baixarConferido, lerNotaParaEnvio, registrarAcesso, segredoDoLink } from "@/lib/envio/arquivos";
import { lerToken } from "@/lib/envio/link";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download pelo link do WhatsApp: confere o token e o SHA-256, grava o log e redireciona para uma URL de 60 s. */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const tipo = new URL(req.url).searchParams.get("tipo");
  if (tipo !== "danfse" && tipo !== "xml_autorizado") return NextResponse.json({ erro: "arquivo inválido" }, { status: 400 });
  const lido = lerToken(token, await segredoDoLink());
  if (!("notaId" in lido)) return NextResponse.json({ erro: lido.erro === "expirado" ? "link vencido" : "link inválido" }, { status: 403 });
  const admin = supabaseAdmin();
  const nota = await lerNotaParaEnvio(admin, lido.notaId);
  const arq = nota ? (await arquivosDaNota(admin, nota)).find((a) => a.tipo === tipo) : undefined;
  if (!nota || !arq) return NextResponse.json({ erro: "arquivo não encontrado" }, { status: 404 });
  try {
    await baixarConferido(admin, arq);
  } catch (e) {
    if (e instanceof ArquivoAlterado) {
      await admin.rpc("fn_avisar", { p_empresa_id: nota.empresa_id, p_tipo: "auditoria_quebrada", p_nota_id: null, p_mensagem: `Arquivo ${arq.storage_path} não confere com o SHA-256 gravado.`, p_quem: null });
      return NextResponse.json({ erro: "o arquivo não confere com o original e não foi entregue" }, { status: 409 });
    }
    return NextResponse.json({ erro: "arquivo indisponível" }, { status: 502 });
  }
  await logSeguranca(admin, { evento: "download_documento", ip: ipDe(req.headers), empresaId: nota.empresa_id, alvo: `documento:${arq.id}`, detalhe: { tipo: arq.tipo, via: "link_tomador", envio: lido.envioId } });
  await registrarAcesso(admin, { empresaId: nota.empresa_id, notaId: nota.id, envioId: lido.envioId, tipo: arq.tipo === "danfse" ? "baixou_danfse" : "baixou_xml", ip: ipDe(req.headers), navegador: req.headers.get("user-agent") });
  const { data: url, error } = await admin.storage.from("documentos").createSignedUrl(arq.storage_path, 60, { download: arq.nome });
  if (error || !url) return NextResponse.json({ erro: "não gerou o link" }, { status: 500 });
  return NextResponse.redirect(url.signedUrl, 302);
}
