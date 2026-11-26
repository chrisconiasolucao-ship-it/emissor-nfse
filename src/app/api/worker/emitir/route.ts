import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { segredoDoWorkerConfere } from "@/lib/auth/sessao";
import { config } from "@/lib/config";
import { portasSupabase } from "@/lib/fila/portas-supabase";
import { rodarFila } from "@/lib/fila/worker";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Chamado pelo pg_cron a cada minuto (AT-008). Um worker por vez (worker_lease). */
export async function POST(req: Request) {
  const c = config();
  if (!segredoDoWorkerConfere(req.headers.get("x-worker-secret"), c.WORKER_SECRET)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const dono = randomUUID();
  const segundos = Math.ceil(c.WORKER_BUDGET_MS / 1000) + 10;
  const { data: pegou, error } = await db.rpc("fn_adquirir_lease", { p_nome: "emitir", p_segundos: segundos, p_dono: dono });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  if (!pegou) return NextResponse.json({ ocupado: true });
  try {
    const resultados = await rodarFila(portasSupabase(db, dono), c.WORKER_BUDGET_MS);
    console.info(JSON.stringify({ worker: "emitir", dono, processadas: resultados.length, resultados }));
    return NextResponse.json({ processadas: resultados.length, resultados });
  } finally {
    await db.rpc("fn_liberar_lease", { p_nome: "emitir", p_dono: dono });
  }
}
