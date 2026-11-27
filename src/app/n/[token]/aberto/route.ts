import { ipDe } from "@/lib/auditoria/audit";
import { lerNotaParaEnvio, registrarAcesso, segredoDoLink } from "@/lib/envio/arquivos";
import { lerToken } from "@/lib/envio/link";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GIF transparente de 1×1
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/**
 * Imagem invisível do e-mail: quando o programa de e-mail a carrega, grava a provável abertura.
 * Aproximado: falha se as imagens estiverem bloqueadas e pode marcar sozinho (iPhone, proxies).
 * Sempre devolve a imagem, mesmo com token ruim, para não aparecer imagem quebrada.
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const lido = lerToken(token, await segredoDoLink());
  if ("notaId" in lido && lido.envioId) {
    const admin = supabaseAdmin();
    const nota = await lerNotaParaEnvio(admin, lido.notaId);
    if (nota) await registrarAcesso(admin, { empresaId: nota.empresa_id, notaId: nota.id, envioId: lido.envioId, tipo: "abriu_email", ip: ipDe(req.headers), navegador: req.headers.get("user-agent") });
  }
  return new Response(new Uint8Array(PIXEL), { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate, private", "Content-Length": String(PIXEL.length) } });
}
