import { NextResponse } from "next/server";
import { eEscritorio } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { empresaAtual } from "@/lib/empresa-atual";
import { dataBR } from "@/lib/relatorios/calculos";
import { nomeArquivo, relatorioPdf, relatorioXlsx } from "@/lib/relatorios/exportar";
import { montarRelatorio } from "@/lib/relatorios/montar";
import { CAMPOS_FILTRO, RELATORIOS, eChave, type Filtros } from "@/lib/relatorios/tipos";
import { supabaseServidor } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PDF ou Excel de um relatório, com os mesmos filtros e a mesma consulta da tela (sessão do usuário, RLS). */
export async function GET(req: Request, ctx: { params: Promise<{ tipo: string }> }) {
  const { tipo } = await ctx.params;
  if (!eChave(tipo)) return NextResponse.json({ erro: "relatório não existe" }, { status: 404 });
  const url = new URL(req.url);
  const formato = url.searchParams.get("formato") === "xlsx" ? "xlsx" : "pdf";
  const db = await supabaseServidor();
  const { data: u } = await db.auth.getUser();
  if (!u.user) return NextResponse.json({ erro: "faça login" }, { status: 401 });
  const perfil = await perfilAtual();
  if (RELATORIOS.find((r) => r.chave === tipo)!.soEscritorio && !eEscritorio(perfil)) {
    return NextResponse.json({ erro: "relatório só do escritório" }, { status: 403 });
  }
  const busca: Filtros = {};
  for (const k of CAMPOS_FILTRO) {
    const v = url.searchParams.get(k);
    if (v) busca[k] = v;
  }
  const { relatorio } = await montarRelatorio(tipo, db, perfil, await empresaAtual(perfil), busca);
  const rodape = {
    geradoEm: dataBR(new Date().toISOString(), true),
    geradoPor: perfil.nome ?? perfil.email ?? "usuário",
    ambiente: process.env.NFSE_AMBIENTE === "producao" ? "PRODUÇÃO" : "PRODUÇÃO RESTRITA (teste, sem valor fiscal)",
  };
  const nome = nomeArquivo(relatorio, formato);
  const corpo = formato === "xlsx" ? new Uint8Array(await relatorioXlsx(relatorio, rodape)) : await relatorioPdf(relatorio, rodape);
  return new NextResponse(corpo as BodyInit, {
    headers: {
      "content-type": formato === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf",
      "content-disposition": `${formato === "pdf" ? "inline" : "attachment"}; filename="${nome}"`,
      "cache-control": "no-store",
    },
  });
}
