import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reais } from "@/lib/money";
import type { DadosNota } from "./mensagens";

export type NotaParaEnvio = {
  id: string;
  empresa_id: string;
  situacao: string;
  numero_nfse: string | null;
  valor_servico: string;
  competencia: string | null;
  documento_id: string | null;
  empresa: { razao_social: string; email: string | null };
  tomador: { nome: string; email: string | null; telefone: string | null } | null;
};

export type ArquivoNota = { id: string; tipo: "danfse" | "xml_autorizado"; storage_path: string; sha256: string; nome: string };

/** Nota com empresa e tomador, lida com o cliente dado (sessão do usuário = RLS decide; admin = já conferido). */
export async function lerNotaParaEnvio(db: SupabaseClient, id: string): Promise<NotaParaEnvio | null> {
  return (await lerNotaComErro(db, id)).nota;
}

/** Igual a lerNotaParaEnvio, mas devolve também o erro do banco, para a tela mostrar o motivo. */
export async function lerNotaComErro(db: SupabaseClient, id: string): Promise<{ nota: NotaParaEnvio | null; erro: string | null }> {
  const { data, error } = await db
    .from("nota")
    .select("id, empresa_id, situacao, numero_nfse, valor_servico, competencia, documento_id, empresa:empresa_id(razao_social, email), tomador:tomador(nome, email, telefone)")
    .eq("id", id)
    .maybeSingle();
  if (error) console.error("lerNotaParaEnvio", id, error);
  return { nota: (data as unknown as NotaParaEnvio) ?? null, erro: error ? `${error.code ?? ""} ${error.message}`.trim() : null };
}

export function dadosDaNota(n: NotaParaEnvio): DadosNota {
  return {
    numero: n.numero_nfse,
    empresa: n.empresa.razao_social,
    tomador: n.tomador?.nome ?? null,
    valor: reais(n.valor_servico),
    competencia: n.competencia ? `${n.competencia.slice(5, 7)}/${n.competencia.slice(0, 4)}` : null,
  };
}

/** DANFSe e XML autorizado da nota (o mais recente de cada). */
export async function arquivosDaNota(db: SupabaseClient, n: Pick<NotaParaEnvio, "id" | "empresa_id" | "documento_id" | "numero_nfse">): Promise<ArquivoNota[]> {
  const { data } = await db
    .from("documento")
    .select("id, tipo, storage_path, sha256, criado_em")
    .eq("empresa_id", n.empresa_id)
    .in("tipo", ["danfse", "xml_autorizado"])
    .or(`nota_id.eq.${n.id},id.eq.${n.documento_id ?? "00000000-0000-0000-0000-000000000000"}`)
    .order("criado_em", { ascending: false });
  const saida: ArquivoNota[] = [];
  for (const tipo of ["danfse", "xml_autorizado"] as const) {
    const d = (data ?? []).find((x) => x.tipo === tipo);
    if (!d) continue;
    const base = `NFSe-${n.numero_nfse ?? n.id.slice(0, 8)}`;
    saida.push({ id: d.id, tipo, storage_path: d.storage_path, sha256: String(d.sha256).trim(), nome: tipo === "danfse" ? `${base}-DANFSe.pdf` : `${base}.xml` });
  }
  return saida;
}

export class ArquivoAlterado extends Error {}

/** Baixa do Storage e confere o SHA-256 gravado (G08): arquivo que não confere não sai. */
export async function baixarConferido(admin: SupabaseClient, a: ArquivoNota): Promise<Buffer> {
  const arq = await admin.storage.from("documentos").download(a.storage_path);
  if (arq.error || !arq.data) throw new Error(`arquivo indisponível: ${a.nome}`);
  const buf = Buffer.from(await arq.data.arrayBuffer());
  const hash = createHash("sha256").update(buf).digest("hex");
  if (hash !== a.sha256) throw new ArquivoAlterado(`O arquivo ${a.nome} não confere com o original e não foi enviado.`);
  return buf;
}

/** Segredo do link temporário do WhatsApp. */
export async function segredoDoLink(): Promise<string> {
  const { config } = await import("@/lib/config");
  const c = config();
  return c.ENVIO_LINK_SECRET ?? c.WORKER_SECRET;
}

/** Endereço público do sistema, para montar o link (Vercel manda x-forwarded-host/proto). */
export function baseUrl(h: Headers): string {
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export type TipoAcesso = "abriu_link" | "baixou_danfse" | "baixou_xml" | "abriu_email";

/** Grava o acesso do tomador. Nunca derruba a resposta: falha de registro só vai para o log. */
export async function registrarAcesso(admin: SupabaseClient, a: { empresaId: string; notaId: string; envioId: string | null; tipo: TipoAcesso; ip: string | null; navegador: string | null }): Promise<void> {
  const linha = { empresa_id: a.empresaId, nota_id: a.notaId, envio_id: a.envioId, tipo: a.tipo, ip: a.ip, navegador: a.navegador?.slice(0, 300) ?? null };
  let { error } = await admin.from("envio_acesso").insert(linha);
  // envio que não chegou a ser gravado (ex.: link de WhatsApp gerado e não usado): guarda só a nota
  if (error?.code === "23503" && a.envioId) ({ error } = await admin.from("envio_acesso").insert({ ...linha, envio_id: null }));
  if (error) console.error("registrarAcesso", a.tipo, error);
}
