import "server-only";
import { gzipSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ancora } from "./verificador";

/**
 * Decision 7: cópia fora do banco no Vercel Blob.
 *  ancoras/AAAA-MM-DD.json          último id e hash da trilha no fim do dia
 *  log-seguranca/AAAA-MM-DD.jsonl.gz eventos de segurança novos desde a última cópia
 * A tabela ancora_auditoria guarda as URLs; o conteúdo que vale é o do Blob (privado: o log tem e-mails e IPs).
 */
export type ArmazemExterno = {
  gravar(caminho: string, conteudo: Buffer, contentType: string): Promise<string>; // devolve a URL
  listar(prefixo: string): Promise<{ caminho: string; url: string }[]>;
  ler(url: string): Promise<Buffer>;
};

export function armazemVercelBlob(token: string): ArmazemExterno {
  return {
    async gravar(caminho, conteudo, contentType) {
      const { put } = await import("@vercel/blob");
      const r = await put(caminho, conteudo, { access: "private", contentType, token, addRandomSuffix: true, allowOverwrite: false });
      return r.url;
    },
    async listar(prefixo) {
      const { list } = await import("@vercel/blob");
      const saida: { caminho: string; url: string }[] = [];
      let cursor: string | undefined;
      do {
        const r = await list({ prefix: prefixo, token, cursor });
        for (const b of r.blobs) saida.push({ caminho: b.pathname, url: b.url });
        cursor = r.hasMore ? r.cursor : undefined;
      } while (cursor);
      return saida;
    },
    async ler(url) {
      const { get } = await import("@vercel/blob");
      const r = await get(url, { access: "private", token, useCache: false });
      if (!r || r.statusCode !== 200) throw new Error("âncora não encontrada no Blob");
      return Buffer.from(await new Response(r.stream).arrayBuffer());
    },
  };
}

export async function gravarAncoraDoDia(db: SupabaseClient, armazem: ArmazemExterno, dia: string): Promise<Ancora | null> {
  const { data: ja } = await db.from("ancora_auditoria").select("dia").eq("dia", dia).maybeSingle();
  if (ja) return null; // já ancorado hoje
  const { data: ult, error } = await db.from("auditoria").select("id, hash").order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`não leu a trilha: ${error.message}`);
  const ancora: Ancora = { dia, ultimoId: ult ? Number(ult.id) : 0, hash: ult?.hash ?? "" };

  // log de segurança desde a última cópia
  const { data: anterior } = await db.from("ancora_auditoria").select("log_ate_id").order("dia", { ascending: false }).limit(1).maybeSingle();
  const desde = Number(anterior?.log_ate_id ?? 0);
  const { data: eventos, error: e2 } = await db.from("log_seguranca").select("*").gt("id", desde).order("id").limit(50_000);
  if (e2) throw new Error(`não leu o log de segurança: ${e2.message}`);
  const linhas = (eventos ?? []).map((e) => JSON.stringify(e)).join("\n");
  const logAte = eventos && eventos.length > 0 ? Number(eventos[eventos.length - 1]!.id) : desde;

  const urlAncora = await armazem.gravar(`ancoras/${dia}.json`, Buffer.from(JSON.stringify(ancora)), "application/json");
  const urlLog = await armazem.gravar(`log-seguranca/${dia}.jsonl.gz`, gzipSync(Buffer.from(linhas)), "application/gzip");
  const { error: e3 } = await db.from("ancora_auditoria").insert({
    dia,
    ultimo_id: ancora.ultimoId,
    hash: ancora.hash || null,
    blob_url: urlAncora,
    log_ate_id: logAte,
    log_blob_url: urlLog,
  });
  if (e3) throw new Error(`não gravou a âncora no banco: ${e3.message}`);
  return ancora;
}

/** Âncoras lidas do Blob (a fonte de verdade fica fora do banco). */
export async function lerAncoras(armazem: ArmazemExterno): Promise<Ancora[]> {
  const itens = await armazem.listar("ancoras/");
  const ancoras: Ancora[] = [];
  for (const i of itens) {
    const a = JSON.parse((await armazem.ler(i.url)).toString("utf8")) as Ancora;
    if (a.ultimoId > 0 && a.hash) ancoras.push(a);
  }
  return ancoras;
}
