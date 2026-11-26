import type { SupabaseClient } from "@supabase/supabase-js";
import { config } from "@/lib/config";
import { sha256 } from "@/lib/importacao/planilha";
import { gerarDanfse } from "@/lib/nfse/danfse";
import { ErroTecnicoSefin } from "@/lib/nfse/erros-sefin";
import { montarPedidoCancelamento, type CodigoCancelamento } from "@/lib/nfse/evento-builder";
import { SefinClient, agenteMtls, transporteHttps } from "@/lib/nfse/sefin-client";
import { assinarXml, type OpcoesAssinatura } from "@/lib/nfse/xml-signer";
import { abrirCertificadoDaEmpresa, portasSupabase } from "./portas-supabase";

export type PedidoCancelar = {
  empresaId: string;
  notaId: string;
  codigoMotivo: CodigoCancelamento;
  motivo: string;
  quem: string;
  ip: string | null;
  /** Só para conferência na produção restrita (worker de eventos); a tela usa o padrão. */
  variante?: { versao?: "1.00" | "1.01" } & OpcoesAssinatura;
};
export type ResultadoCancelar = { ok: true } | { ok: false; erro: string; corpoSefin?: string };

/**
 * Cancelamento na Receita (AT-015): monta e assina o pedRegEvento, envia, guarda o XML do evento,
 * registra no banco (fn_registrar_evento confere a permissão de novo) e gera o DANFSe com a marca CANCELADA.
 * Quem chama já conferiu a permissão e registrou o uso do certificado.
 */
export async function cancelarNaReceita(admin: SupabaseClient, d: PedidoCancelar): Promise<ResultadoCancelar> {
  const c = config();
  const { data: nota } = await admin.from("nota").select("chave_acesso, situacao, documento_id, empresa:empresa_id(cnpj)").eq("empresa_id", d.empresaId).eq("id", d.notaId).single();
  if (!nota || nota.situacao !== "autorizada" || !nota.chave_acesso) return { ok: false, erro: "Só nota autorizada pode ser cancelada." };
  const cert = await abrirCertificadoDaEmpresa(admin, d.empresaId);
  const cnpj = String((nota.empresa as unknown as { cnpj: string }).cnpj);
  const pedido = montarPedidoCancelamento({ ambiente: c.NFSE_AMBIENTE, cnpjAutor: cnpj, chaveAcesso: nota.chave_acesso, codigoMotivo: d.codigoMotivo, motivo: d.motivo, em: new Date(), versao: d.variante?.versao });
  const assinado = assinarXml(pedido.xml, "infPedReg", cert.aberto.chavePrivadaPem, cert.aberto.certificadoPem, d.variante);
  const sefin = new SefinClient(c.SEFIN_BASE_URL, transporteHttps(agenteMtls(cert.pfx, cert.senha)));
  let resp;
  try {
    resp = await sefin.registrarEvento(nota.chave_acesso, assinado);
  } catch (e) {
    const corpo = e instanceof ErroTecnicoSefin ? e.corpo : undefined;
    console.error(JSON.stringify({ acao: "cancelamento", nota: d.notaId, erro: e instanceof Error ? e.message : String(e), corpo }));
    return { ok: false, erro: `A Receita não respondeu. Tente de novo em alguns minutos. (${e instanceof Error ? e.message : e})`, corpoSefin: corpo };
  }
  if (resp.tipo === "rejeitado") return { ok: false, erro: `A Receita recusou o cancelamento: ${resp.mensagem}` };

  const xml = Buffer.from(resp.eventoXml, "utf8");
  const hash = sha256(xml);
  const caminho = `${d.empresaId}/notas/${d.notaId}/evento-cancelamento-${hash.slice(0, 12)}.xml`;
  const up = await admin.storage.from("documentos").upload(caminho, xml, { contentType: "application/xml", upsert: false });
  if (up.error && !/exists|duplicate/i.test(up.error.message)) return { ok: false, erro: `Cancelado na Receita, mas o XML do evento não foi guardado: ${up.error.message}` };
  const doc = await admin.from("documento").insert({ empresa_id: d.empresaId, tipo: "xml_evento", storage_path: caminho, sha256: hash, tamanho: xml.length, content_type: "application/xml", nota_id: d.notaId, criado_por: d.quem }).select("id").single();
  const { error } = await admin.rpc("fn_registrar_evento", {
    p_empresa_id: d.empresaId,
    p_nota_id: d.notaId,
    p_tipo: "cancelamento",
    p_codigo_motivo: d.codigoMotivo,
    p_motivo: d.motivo,
    p_quem: d.quem,
    p_protocolo: pedido.id,
    p_documento_id: doc.data?.id ?? null,
    p_nota_substituta_id: null,
    p_ip: d.ip,
  });
  if (error) return { ok: false, erro: `Cancelado na Receita, mas o sistema não registrou: ${error.message}. Avise o escritório.` };
  // DANFSe com a marca CANCELADA (NT 008, item 2.5.1); se falhar, a nota continua cancelada e o PDF anterior fica
  try {
    const { data: xmlDoc } = await admin.from("documento").select("storage_path").eq("empresa_id", d.empresaId).eq("id", nota.documento_id).single();
    const arq = xmlDoc ? await admin.storage.from("documentos").download(String(xmlDoc.storage_path)) : null;
    if (arq?.data) {
      const portas = portasSupabase(admin, "cancelamento");
      const pdf = await gerarDanfse(await arq.data.text(), { nomeMunicipio: portas.nomeMunicipio, situacao: "cancelada" });
      await portas.guardarDocumento({ empresaId: d.empresaId, id: d.notaId } as never, "danfse", pdf, "application/pdf");
    }
  } catch (e) {
    console.error(JSON.stringify({ acao: "danfse_cancelada", nota: d.notaId, erro: e instanceof Error ? e.message : String(e) }));
  }
  return { ok: true };
}
