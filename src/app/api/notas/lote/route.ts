import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ipDe, logSeguranca } from "@/lib/auditoria/audit";
import { perfilAtual } from "@/lib/auth/sessao";
import { empresaAtual } from "@/lib/empresa-atual";
import { gerarDanfse } from "@/lib/nfse/danfse";
import { lerDadosDoLote } from "@/lib/notas/lote-dados";
import { LIMITE_COM_PDF, LIMITE_XML, montarLote, nomeDoZip, resumoCsv, tipoLote, type ArquivoLote } from "@/lib/notas/lote";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServidor } from "@/lib/supabase/server";
import { EscritorZip } from "@/lib/zip/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SIMULTANEOS = 6;

const mes = (v: string | null) => (v && /^\d{4}-\d{2}$/.test(v) ? v : undefined);

/**
 * ZIP com os XMLs (e, se pedido, os PDFs) das NFS-e prestadas e tomadas da empresa aberta, por competência.
 * Cada arquivo é conferido com o SHA-256 gravado (G08) antes de entrar; o que não confere fica de fora e
 * aparece no LEIA-ME. O download gera um registro "exportacao" no log de segurança (AT-033).
 */
export async function GET(req: Request) {
  const perfil = await perfilAtual();
  const empresa = await empresaAtual(perfil);
  if (!empresa) return NextResponse.redirect(new URL("/baixar", req.url), 303);

  const u = new URL(req.url);
  let de = mes(u.searchParams.get("de"));
  let ate = mes(u.searchParams.get("ate"));
  if (de && ate && de > ate) [de, ate] = [ate, de];
  const tipo = tipoLote(u.searchParams.get("tipo"));
  const pdf = u.searchParams.get("pdf") === "1";

  const db = await supabaseServidor();
  const dados = await lerDadosDoLote(db, empresa.id, de, ate);
  const { arquivos, resumo } = montarLote({ tipo, pdf, ...dados });
  const voltar = (motivo: string) => {
    const v = new URL("/baixar", req.url);
    for (const [k, val] of [["de", de ?? ""], ["ate", ate ?? ""], ["tipo", tipo], ["pdf", pdf ? "1" : ""], ["aviso", motivo]] as const) v.searchParams.set(k, val);
    return NextResponse.redirect(v, 303);
  };
  if (!resumo.length) return voltar("vazio");
  if (resumo.length > (pdf ? LIMITE_COM_PDF : LIMITE_XML)) return voltar("grande");

  const admin = supabaseAdmin();
  await logSeguranca(admin, {
    evento: "exportacao", usuarioId: perfil.usuarioId, email: perfil.email, ip: ipDe(req.headers), empresaId: empresa.id,
    alvo: `lote_nfse:${empresa.id}`, detalhe: { de: de ?? null, ate: ate ?? null, tipo, pdf, notas: resumo.length, arquivos: arquivos.length },
  });

  const municipios = new Map<string, Promise<string | null>>();
  const nomeMunicipio = (cod: string) => {
    if (!municipios.has(cod)) {
      municipios.set(cod, Promise.resolve(admin.from("municipio_situacao").select("nome, uf").eq("cod_ibge", cod).maybeSingle())
        .then(({ data }) => (data ? `${String(data.nome)} / ${String(data.uf)}` : null)));
    }
    return municipios.get(cod)!;
  };

  // o mesmo XML pode servir para o XML e para o PDF gerado: baixa uma vez só
  const baixados = new Map<string, Promise<Buffer>>();
  const baixar = (a: ArquivoLote) => {
    if (!baixados.has(a.doc.id)) {
      baixados.set(a.doc.id, (async () => {
        const arq = await admin.storage.from("documentos").download(a.doc.storage_path);
        if (arq.error || !arq.data) throw new Error("arquivo indisponível no armazenamento");
        const buf = Buffer.from(await arq.data.arrayBuffer());
        if (createHash("sha256").update(buf).digest("hex") !== String(a.doc.sha256).trim()) {
          await admin.rpc("fn_avisar", { p_empresa_id: empresa.id, p_tipo: "auditoria_quebrada", p_nota_id: null, p_mensagem: `Arquivo ${a.doc.storage_path} não confere com o SHA-256 gravado.`, p_quem: null });
          throw new Error("o arquivo não confere com o original (SHA-256)");
        }
        return buf;
      })());
    }
    return baixados.get(a.doc.id)!;
  };
  const conteudo = async (a: ArquivoLote): Promise<Buffer> => {
    const buf = await baixar(a);
    return a.gerarPdf ? gerarDanfse(buf.toString("utf8"), { nomeMunicipio, situacao: a.situacao }) : buf;
  };

  const zip = new EscritorZip();
  const falhas: string[] = [];
  const corpo = new ReadableStream<Uint8Array>({
    async start(ctl) {
      try {
        for (let i = 0; i < arquivos.length; i += SIMULTANEOS) {
          const grupo = arquivos.slice(i, i + SIMULTANEOS);
          const prontos = await Promise.allSettled(grupo.map(conteudo));
          prontos.forEach((r, j) => {
            const caminho = grupo[j]!.caminho;
            if (r.status === "fulfilled") ctl.enqueue(zip.adicionar(caminho, r.value));
            else falhas.push(`${caminho}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
          });
        }
        ctl.enqueue(zip.adicionar("resumo.csv", Buffer.from(resumoCsv(resumo), "utf8")));
        const periodo = de && ate ? (de === ate ? `competência ${de}` : `competências ${de} a ${ate}`) : de ? `desde ${de}` : ate ? `até ${ate}` : "todos os meses";
        const leia = [
          `${empresa.razao_social} (CNPJ ${empresa.cnpj})`,
          `NFS-e ${tipo === "ambas" ? "prestadas e tomadas" : tipo} · ${periodo} · gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
          "",
          `${resumo.length} notas. Pastas: "prestadas" e "tomadas" com os XMLs; "eventos" com o XML do cancelamento;${pdf ? ' "PDF" com o DANFSe;' : ""} resumo.csv para conferência no Excel.`,
          ...(falhas.length ? ["", `ATENÇÃO: ${falhas.length} arquivo(s) ficaram de fora:`, ...falhas] : []),
        ].join("\r\n");
        ctl.enqueue(zip.adicionar(falhas.length ? "LEIA-ME - ARQUIVOS FALTANDO.txt" : "LEIA-ME.txt", Buffer.from(`﻿${leia}\r\n`, "utf8")));
        ctl.enqueue(zip.finalizar());
        ctl.close();
      } catch (e) {
        console.error("lote NFS-e", empresa.id, e);
        ctl.error(e);
      }
    },
  });

  const nome = nomeDoZip(empresa.cnpj, de, ate, tipo);
  return new Response(corpo, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${nome}"`,
      "cache-control": "no-store",
    },
  });
}
