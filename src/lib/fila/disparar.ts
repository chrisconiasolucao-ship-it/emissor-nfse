import "server-only";
import { headers } from "next/headers";
import { after } from "next/server";
import { config } from "@/lib/config";

/**
 * Começa a emissão logo depois do clique, sem esperar o pg_cron (que roda a cada minuto). Roda depois da
 * resposta (after), então a tela não espera a Receita. Se outro worker já estiver rodando (lease ocupado),
 * ele mesmo pega a nota; se a chamada falhar, o pg_cron pega no minuto seguinte, como antes.
 */
export async function dispararFila(): Promise<void> {
  const h = await headers();
  const host = h.get("host");
  if (!host) return;
  const base = `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
  const segredo = config().WORKER_SECRET;
  after(async () => {
    try {
      await fetch(`${base}/api/worker/emitir`, { method: "POST", headers: { "x-worker-secret": segredo } });
    } catch (e) {
      console.error(JSON.stringify({ acao: "disparar_fila", erro: e instanceof Error ? e.message : String(e) }));
    }
  });
}
