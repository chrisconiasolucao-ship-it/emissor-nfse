import { NextResponse } from "next/server";
import { gerarModeloPlanilha } from "@/lib/importacao/modelo-planilha";
import { supabaseServidor } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const db = await supabaseServidor();
  const { data } = await db.auth.getUser();
  if (!data.user) return NextResponse.json({ erro: "faça login" }, { status: 401 });
  return new NextResponse(new Uint8Array(await gerarModeloPlanilha()), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="modelo-notas.xlsx"',
    },
  });
}
