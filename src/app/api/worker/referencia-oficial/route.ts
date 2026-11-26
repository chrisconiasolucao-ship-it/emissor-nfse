import { NextResponse } from "next/server";
import { segredoDoWorkerConfere } from "@/lib/auth/sessao";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ferramenta de manutenção: baixa um arquivo oficial do Portal da NFS-e (esquemas XSD, anexos) e devolve em Base64,
 * para conferir o leiaute em uso. Só aceita endereços de www.gov.br/nfse/ e exige o segredo do worker.
 */
export async function POST(req: Request) {
  const c = config();
  if (!segredoDoWorkerConfere(req.headers.get("x-worker-secret"), c.WORKER_SECRET)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const alvo = new URL(req.url).searchParams.get("url") ?? "";
  if (!alvo.startsWith("https://www.gov.br/nfse/")) {
    return NextResponse.json({ erro: "só arquivos de https://www.gov.br/nfse/" }, { status: 400 });
  }
  const r = await fetch(alvo, { headers: { "user-agent": "emissor-nfse/1.0" }, redirect: "follow" });
  const corpo = Buffer.from(await r.arrayBuffer());
  return NextResponse.json({ status: r.status, tipo: r.headers.get("content-type"), bytes: corpo.length, b64: corpo.toString("base64") });
}
