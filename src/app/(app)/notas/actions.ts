"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auditar, ipDe, logSeguranca } from "@/lib/auditoria/audit";
import { eEscritorio, exigir, podeCancelarOuSubstituir, podeEmitir } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { config } from "@/lib/config";
import { abrirCertificadoDaEmpresa, portasSupabase } from "@/lib/fila/portas-supabase";
import { mensagemDuplicidade, parecidas, type NotaComparavel } from "@/lib/importacao/duplicidade";
import { lerPlanilha, PlanilhaGrandeDemais, PlanilhaInvalida, sha256, type LinhaNota } from "@/lib/importacao/planilha";
import { competenciaAtual, repetirMes } from "@/lib/importacao/repetir-mes";
import { dinheiro, lerValor } from "@/lib/money";
import { gerarDanfse } from "@/lib/nfse/danfse";
import { montarPedidoCancelamento, type CodigoCancelamento } from "@/lib/nfse/evento-builder";
import { SefinClient, agenteMtls, transporteHttps } from "@/lib/nfse/sefin-client";
import { assinarXml } from "@/lib/nfse/xml-signer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServidor } from "@/lib/supabase/server";

export type Estado = { ok?: boolean; erro?: string; confirmar?: string; mensagem?: string; erros?: { linha: number; campo: string; mensagem: string }[] };

const txt = (max = 255) => z.string().trim().max(max);
const opc = (max = 255) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

const notaSchema = z
  .object({
    id: z.uuid().optional().or(z.literal("").transform(() => undefined)),
    empresa_id: z.uuid(),
    tomador_tipo: z.enum(["CPF", "CNPJ"]),
    tomador_documento: txt(20).transform((v) => v.replace(/\D/g, "")),
    tomador_nome: txt(300).min(1, "informe o nome do tomador"),
    tomador_email: opc(),
    tomador_cep: opc(9),
    tomador_cod_municipio: opc(7),
    tomador_logradouro: opc(),
    tomador_numero: opc(60),
    tomador_complemento: opc(),
    tomador_bairro: opc(),
    codigo_tributacao_nacional: txt(6).regex(/^\d{6}$/, "código de tributação com 6 dígitos"),
    codigo_nbs: opc(9),
    descricao: txt(2000).min(1, "informe a descrição"),
    cod_municipio_prestacao: txt(7).regex(/^\d{7}$/, "escolha o município da prestação na lista"),
    valor: txt(30).refine((v) => {
      try {
        return lerValor(v).greaterThan(0);
      } catch {
        return false;
      }
    }, "valor inválido"),
    competencia: txt(7).regex(/^\d{4}-\d{2}$/, "competência AAAA-MM"),
    iss_retido: z.string().optional().transform((v) => v === "on" || v === "true"),
    aliquota_iss: opc(10),
    origem: z.enum(["avulsa", "modelo"]).default("avulsa"),
    documento_origem_id: z.uuid().optional().or(z.literal("").transform(() => undefined)),
    nota_substituida_id: z.uuid().optional().or(z.literal("").transform(() => undefined)),
    codigo_motivo_substituicao: z.enum(["01", "02", "03", "04", "05", "99"]).optional().or(z.literal("").transform(() => undefined)),
    motivo_substituicao: opc(255),
    acao: z.enum(["rascunho", "emitir"]),
    confirmar_duplicidade: z.string().optional().transform((v) => v === "sim"),
  })
  .refine((d) => !d.iss_retido || !!d.aliquota_iss, { message: "ISS retido exige alíquota", path: ["aliquota_iss"] })
  .refine((d) => !d.nota_substituida_id || (d.codigo_motivo_substituicao && (d.motivo_substituicao ?? "").length >= 15), {
    message: "substituição exige código e motivo com pelo menos 15 caracteres",
    path: ["motivo_substituicao"],
  });

async function garantirTomador(db: Awaited<ReturnType<typeof supabaseServidor>>, empresaId: string, t: LinhaNota["tomador"]): Promise<string> {
  const linha = {
    empresa_id: empresaId,
    tipo_documento: t.tipoDocumento,
    documento: t.documento,
    nome: t.nome,
    email: t.email,
    cep: t.endereco?.cep ?? null,
    cod_municipio: t.endereco?.codMunicipio ?? null,
    logradouro: t.endereco?.logradouro ?? null,
    numero: t.endereco?.numero ?? null,
    complemento: t.endereco?.complemento ?? null,
    bairro: t.endereco?.bairro ?? null,
  };
  const { data, error } = await db.from("tomador").upsert(linha, { onConflict: "empresa_id,tipo_documento,documento" }).select("id").single();
  if (error) throw new Error(`tomador: ${error.message}`);
  return String(data.id);
}

async function avisarSeCliente(perfil: Awaited<ReturnType<typeof perfilAtual>>, empresaId: string, notaId: string, mensagem: string) {
  if (eEscritorio(perfil)) return;
  await supabaseAdmin().rpc("fn_avisar", { p_empresa_id: empresaId, p_tipo: "emissao_cliente", p_nota_id: notaId, p_mensagem: mensagem, p_quem: perfil.usuarioId });
}

/** Rascunho e envio para a fila (AT-022 duplicidade; o banco confere a completude). */
export async function salvarNota(_: Estado, form: FormData): Promise<Estado> {
  const perfil = await perfilAtual();
  const r = notaSchema.safeParse(Object.fromEntries(form));
  if (!r.success) return { erro: r.error.issues.map((i) => i.message).join("; ") };
  const d = r.data;
  exigir(podeEmitir(perfil, d.empresa_id));
  const db = await supabaseServidor();

  const tomadorId = await garantirTomador(db, d.empresa_id, {
    tipoDocumento: d.tomador_tipo,
    documento: d.tomador_documento,
    nome: d.tomador_nome,
    email: d.tomador_email,
    endereco:
      d.tomador_cep && d.tomador_cod_municipio && d.tomador_logradouro
        ? { cep: d.tomador_cep.replace(/\D/g, ""), codMunicipio: d.tomador_cod_municipio, logradouro: d.tomador_logradouro, numero: d.tomador_numero ?? "S/N", complemento: d.tomador_complemento, bairro: d.tomador_bairro ?? "NÃO INFORMADO" }
        : null,
  });
  const valor = dinheiro(d.valor);
  const competencia = `${d.competencia}-01`;
  const campos = {
    empresa_id: d.empresa_id,
    origem: d.origem,
    tomador_id: tomadorId,
    codigo_tributacao_nacional: d.codigo_tributacao_nacional,
    codigo_nbs: d.codigo_nbs,
    descricao: d.descricao,
    cod_municipio_prestacao: d.cod_municipio_prestacao,
    valor_servico: valor,
    competencia,
    iss_retido: d.iss_retido,
    aliquota_iss: d.iss_retido ? lerValor(d.aliquota_iss!).toFixed(2) : null,
    documento_origem_id: d.documento_origem_id ?? null,
    codigo_motivo_substituicao: d.codigo_motivo_substituicao ?? null,
    motivo_substituicao: d.motivo_substituicao,
  };

  let id = d.id;
  if (id) {
    const { error } = await db.from("nota").update({ ...campos, situacao: "rascunho" }).eq("empresa_id", d.empresa_id).eq("id", id);
    if (error) return { erro: error.message };
  } else {
    const { data, error } = await db.from("nota").insert({ ...campos, nota_substituida_id: d.nota_substituida_id ?? null }).select("id").single();
    if (error) return { erro: error.message };
    id = String(data.id);
  }

  if (d.acao === "emitir") {
    const r2 = await enfileirar(db, perfil, d.empresa_id, id, d.confirmar_duplicidade);
    if (r2) return r2;
  }
  revalidatePath("/notas");
  redirect(`/notas/${id}`);
}

type Db = Awaited<ReturnType<typeof supabaseServidor>>;

/** Rascunho → fila, com o aviso de nota parecida (AT-022). Devolve Estado só quando para. */
async function enfileirar(db: Db, perfil: Awaited<ReturnType<typeof perfilAtual>>, empresaId: string, id: string, confirmado: boolean): Promise<Estado | null> {
  const { data: n, error: e0 } = await db.from("nota").select("tomador_id, valor_servico, descricao, competencia").eq("empresa_id", empresaId).eq("id", id).single();
  if (e0 || !n) return { erro: "Nota não encontrada." };
  const { data: outras } = await db
    .from("nota")
    .select("id, empresa_id, tomador_id, valor_servico, descricao, competencia, situacao")
    .eq("empresa_id", empresaId)
    .eq("tomador_id", n.tomador_id)
    .eq("competencia", n.competencia);
  const iguais = parecidas(
    { id, empresaId, tomadorId: n.tomador_id, valorServico: n.valor_servico, descricao: n.descricao, competencia: n.competencia },
    ((outras ?? []) as Record<string, unknown>[]).map(
      (o): NotaComparavel => ({ id: String(o.id), empresaId: String(o.empresa_id), tomadorId: String(o.tomador_id), valorServico: String(o.valor_servico), descricao: String(o.descricao), competencia: String(o.competencia), situacao: String(o.situacao) }),
    ),
  );
  if (iguais.length > 0 && !confirmado) return { confirmar: mensagemDuplicidade(iguais.length), mensagem: id };
  const { error } = await db.from("nota").update({ situacao: "na_fila", duplicidade_confirmada: iguais.length > 0 }).eq("empresa_id", empresaId).eq("id", id);
  if (error) return { erro: error.message };
  await avisarSeCliente(perfil, empresaId, id, `Nota enviada para emissão por ${perfil.email ?? "cliente"}: R$ ${n.valor_servico}.`);
  return null;
}

export async function emitirRascunho(_: Estado, form: FormData): Promise<Estado> {
  const perfil = await perfilAtual();
  const empresaId = z.uuid().parse(form.get("empresa_id"));
  const id = z.uuid().parse(form.get("id"));
  exigir(podeEmitir(perfil, empresaId));
  const r = await enfileirar(await supabaseServidor(), perfil, empresaId, id, form.get("confirmar_duplicidade") === "sim");
  if (r) return r;
  revalidatePath(`/notas/${id}`);
  return { ok: true, mensagem: "Nota enviada para a fila de emissão." };
}

export async function excluirRascunho(form: FormData): Promise<void> {
  const perfil = await perfilAtual();
  const empresaId = String(form.get("empresa_id"));
  exigir(podeEmitir(perfil, empresaId));
  const db = await supabaseServidor();
  await db.from("nota").delete().eq("empresa_id", empresaId).eq("id", String(form.get("id"))).eq("situacao", "rascunho");
  revalidatePath("/notas");
  redirect("/notas");
}

/** Cancelamento (AT-014, AT-015, AT-016): só escritório ou admin do cliente; o banco confere de novo. */
const cancelarSchema = z.object({
  empresa_id: z.uuid(),
  id: z.uuid(),
  codigo_motivo: z.enum(["1", "2", "9"]),
  motivo: z.string().trim().min(15, "o motivo precisa ter pelo menos 15 caracteres").max(255),
});

export async function cancelarNota(_: Estado, form: FormData): Promise<Estado> {
  const perfil = await perfilAtual();
  const r = cancelarSchema.safeParse(Object.fromEntries(form));
  if (!r.success) return { erro: r.error.issues.map((i) => i.message).join("; ") };
  const d = r.data;
  if (!podeCancelarOuSubstituir(perfil, d.empresa_id)) return { erro: "Só o escritório ou o administrador da empresa pode cancelar nota." };
  const c = config();
  const db = await supabaseServidor();
  const { data: nota } = await db.from("nota").select("chave_acesso, situacao, documento_id, empresa:empresa_id(cnpj)").eq("empresa_id", d.empresa_id).eq("id", d.id).single();
  if (!nota || nota.situacao !== "autorizada" || !nota.chave_acesso) return { erro: "Só nota autorizada pode ser cancelada." };

  const admin = supabaseAdmin();
  const ip = ipDe(await headers());
  const cert = await abrirCertificadoDaEmpresa(admin, d.empresa_id);
  await logSeguranca(admin, { evento: "uso_certificado", usuarioId: perfil.usuarioId, email: perfil.email, ip, empresaId: d.empresa_id, alvo: d.id, detalhe: { acao: "cancelamento" } });
  await auditar(admin, { empresaId: d.empresa_id, acao: "uso_certificado", entidade: "nota", entidadeId: d.id, depois: { acao: "cancelamento", certificado_sha256: cert.aberto.sha256 }, quem: perfil.usuarioId, ip });
  const cnpj = String((nota.empresa as unknown as { cnpj: string }).cnpj);
  const pedido = montarPedidoCancelamento({ ambiente: c.NFSE_AMBIENTE, cnpjAutor: cnpj, chaveAcesso: nota.chave_acesso, codigoMotivo: d.codigo_motivo as CodigoCancelamento, motivo: d.motivo, em: new Date() });
  const assinado = assinarXml(pedido.xml, "infPedReg", cert.aberto.chavePrivadaPem, cert.aberto.certificadoPem);
  const sefin = new SefinClient(c.SEFIN_BASE_URL, transporteHttps(agenteMtls(cert.pfx, cert.senha)));
  let resp;
  try {
    resp = await sefin.registrarEvento(nota.chave_acesso, assinado);
  } catch (e) {
    return { erro: `A Receita não respondeu. Tente de novo em alguns minutos. (${e instanceof Error ? e.message : e})` };
  }
  if (resp.tipo === "rejeitado") return { erro: `A Receita recusou o cancelamento: ${resp.mensagem}` };

  const xml = Buffer.from(resp.eventoXml, "utf8");
  const hash = sha256(xml);
  const caminho = `${d.empresa_id}/notas/${d.id}/evento-cancelamento-${hash.slice(0, 12)}.xml`;
  const up = await admin.storage.from("documentos").upload(caminho, xml, { contentType: "application/xml", upsert: false });
  if (up.error && !/exists|duplicate/i.test(up.error.message)) return { erro: `Cancelado na Receita, mas o XML do evento não foi guardado: ${up.error.message}` };
  const doc = await admin.from("documento").insert({ empresa_id: d.empresa_id, tipo: "xml_evento", storage_path: caminho, sha256: hash, tamanho: xml.length, content_type: "application/xml", nota_id: d.id, criado_por: perfil.usuarioId }).select("id").single();
  const { error } = await admin.rpc("fn_registrar_evento", {
    p_empresa_id: d.empresa_id,
    p_nota_id: d.id,
    p_tipo: "cancelamento",
    p_codigo_motivo: d.codigo_motivo,
    p_motivo: d.motivo,
    p_quem: perfil.usuarioId,
    p_protocolo: pedido.id,
    p_documento_id: doc.data?.id ?? null,
    p_nota_substituta_id: null,
    p_ip: ip,
  });
  if (error) return { erro: `Cancelado na Receita, mas o sistema não registrou: ${error.message}. Avise o escritório.` };
  // DANFSe com a marca CANCELADA (NT 008, item 2.5.1); se falhar, a nota continua cancelada e o PDF anterior fica
  try {
    const { data: xmlDoc } = await admin.from("documento").select("storage_path").eq("empresa_id", d.empresa_id).eq("id", nota.documento_id).single();
    const arq = xmlDoc ? await admin.storage.from("documentos").download(String(xmlDoc.storage_path)) : null;
    if (arq?.data) {
      const portas = portasSupabase(admin, "cancelamento");
      const pdf = await gerarDanfse(await arq.data.text(), { nomeMunicipio: portas.nomeMunicipio, situacao: "cancelada" });
      await portas.guardarDocumento({ empresaId: d.empresa_id, id: d.id } as never, "danfse", pdf, "application/pdf");
    }
  } catch (e) {
    console.error(JSON.stringify({ acao: "danfse_cancelada", nota: d.id, erro: e instanceof Error ? e.message : String(e) }));
  }
  revalidatePath(`/notas/${d.id}`);
  return { ok: true, mensagem: "Nota cancelada." };
}

/** Planilha (AT-017, AT-018, AT-031): até 30 linhas, cada linha vira uma nota na fila. */
export async function importarPlanilha(_: Estado, form: FormData): Promise<Estado> {
  const perfil = await perfilAtual();
  const empresaId = String(form.get("empresa_id"));
  exigir(podeEmitir(perfil, empresaId));
  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { erro: "Escolha a planilha." };
  if (arquivo.size > 2 * 1024 * 1024) return { erro: "Planilha maior que 2 MB." };
  const buf = Buffer.from(await arquivo.arrayBuffer());
  let lida;
  try {
    lida = await lerPlanilha(buf, arquivo.name, config().PLANILHA_MAX_LINHAS);
  } catch (e) {
    if (e instanceof PlanilhaGrandeDemais || e instanceof PlanilhaInvalida) return { erro: e.message };
    throw e;
  }
  if (lida.erros.length > 0) return { erro: "A planilha tem erros; nada foi importado. Corrija e envie de novo.", erros: lida.erros };

  const admin = supabaseAdmin();
  const caminho = `${empresaId}/planilhas/${lida.sha256}.${arquivo.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx"}`;
  // arquivo primeiro (sem sobrescrever), depois o documento: o UNIQUE do SHA-256 recusa a 2ª importação
  const up = await admin.storage.from("documentos").upload(caminho, buf, { contentType: arquivo.type || "application/octet-stream", upsert: false });
  if (up.error && !/exists|duplicate/i.test(up.error.message)) return { erro: `Storage: ${up.error.message}` };
  const doc = await admin.from("documento").insert({ empresa_id: empresaId, tipo: "planilha", storage_path: caminho, sha256: lida.sha256, tamanho: buf.length, content_type: arquivo.type || "application/octet-stream", nome_original: arquivo.name, criado_por: perfil.usuarioId }).select("id").single();
  if (doc.error?.code === "23505") return { erro: "Esta planilha já foi importada. Nada novo foi importado." };
  if (doc.error) return { erro: doc.error.message };
  const imp = await admin.from("importacao").insert({ empresa_id: empresaId, tipo: "planilha", documento_id: doc.data.id, linhas: lida.linhas.length, criado_por: perfil.usuarioId }).select("id").single();
  if (imp.error) return { erro: imp.error.code === "23505" ? "Esta planilha já foi importada. Nada novo foi importado." : imp.error.message };

  const { data: emp } = await admin.from("empresa").select("cod_municipio").eq("id", empresaId).single();
  const db = await supabaseServidor();
  let criadas = 0;
  for (const l of lida.linhas) {
    const tomadorId = await garantirTomador(db, empresaId, l.tomador);
    const { data: n, error } = await admin
      .from("nota")
      .insert({
        empresa_id: empresaId,
        situacao: "na_fila",
        origem: "planilha",
        tomador_id: tomadorId,
        codigo_tributacao_nacional: l.codigoTributacaoNacional,
        codigo_nbs: l.codigoNbs,
        descricao: l.descricao,
        cod_municipio_prestacao: emp?.cod_municipio,
        valor_servico: l.valorServico,
        competencia: l.competencia,
        iss_retido: l.issRetido,
        aliquota_iss: l.aliquotaIss,
        documento_origem_id: doc.data.id,
        importacao_id: imp.data.id,
        criado_por: perfil.usuarioId,
      })
      .select("id")
      .single();
    if (error) return { erro: `Linha ${l.linha}: ${error.message}. ${criadas} nota(s) já foram para a fila.` };
    criadas++;
    if (criadas === 1) await avisarSeCliente(perfil, empresaId, String(n.id), `Planilha ${arquivo.name} importada por ${perfil.email ?? "cliente"}: ${lida.linhas.length} nota(s).`);
  }
  await admin.from("importacao").update({ notas_criadas: criadas }).eq("empresa_id", empresaId).eq("id", imp.data.id);
  revalidatePath("/notas");
  return { ok: true, mensagem: `${criadas} nota(s) foram para a fila de emissão.` };
}

/** Repetir o mês anterior (AT-020): cria rascunhos para conferir antes de emitir. */
export async function repetirMesAnterior(_: Estado, form: FormData): Promise<Estado> {
  const perfil = await perfilAtual();
  const empresaId = String(form.get("empresa_id"));
  exigir(podeEmitir(perfil, empresaId));
  const competencia = String(form.get("competencia") || competenciaAtual()).slice(0, 7) + "-01";
  const r = await repetirMes(supabaseAdmin(), empresaId, competencia, perfil.usuarioId);
  revalidatePath("/notas");
  if (r.jaExistia) return { erro: `O mês ${competencia.slice(0, 7)} já foi repetido. Nada novo foi criado.` };
  return { ok: true, mensagem: r.criadas === 0 ? "Nenhuma nota autorizada no mês anterior." : `${r.criadas} rascunho(s) criados. Confira e emita na lista de notas.` };
}

/** XML de nota anterior para servir de modelo (AT-019, AT-031). */
export async function importarXmlModelo(_: Estado, form: FormData): Promise<Estado> {
  const perfil = await perfilAtual();
  const empresaId = String(form.get("empresa_id"));
  exigir(podeEmitir(perfil, empresaId));
  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0 || arquivo.size > 1024 * 1024) return { erro: "Escolha um XML de NFS-e (até 1 MB)." };
  const buf = Buffer.from(await arquivo.arrayBuffer());
  const { lerNfse } = await import("@/lib/nfse/nfse-parser");
  try {
    lerNfse(buf.toString("utf8"));
  } catch (e) {
    return { erro: `Não é uma NFS-e do padrão nacional: ${e instanceof Error ? e.message : e}` };
  }
  const admin = supabaseAdmin();
  const hash = sha256(buf);
  const caminho = `${empresaId}/xml/${hash}.xml`;
  const up = await admin.storage.from("documentos").upload(caminho, buf, { contentType: "application/xml", upsert: false });
  if (up.error && !/exists|duplicate/i.test(up.error.message)) return { erro: `Storage: ${up.error.message}` };
  const doc = await admin.from("documento").insert({ empresa_id: empresaId, tipo: "xml_origem", storage_path: caminho, sha256: hash, tamanho: buf.length, content_type: "application/xml", nome_original: arquivo.name, criado_por: perfil.usuarioId }).select("id").single();
  if (doc.error?.code === "23505") return { erro: "Este XML já foi importado. Nada novo foi importado." };
  if (doc.error) return { erro: doc.error.message };
  redirect(`/notas/nova?empresa=${empresaId}&documento=${doc.data.id}`);
}

/** Busca notas no ADN para a empresa (chama a rota do worker no servidor, com o segredo). */
export async function buscarNoAdn(_: Estado, form: FormData): Promise<Estado> {
  const perfil = await perfilAtual();
  const empresaId = String(form.get("empresa_id"));
  exigir(podeEmitir(perfil, empresaId));
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const r = await fetch(`${base}/api/worker/adn?empresa=${empresaId}`, { method: "POST", headers: { "x-worker-secret": config().WORKER_SECRET } });
  const j = (await r.json().catch(() => ({}))) as { ocupado?: boolean; empresas?: { novos?: number; repetidos?: number; erro?: string }[] };
  if (j.ocupado) return { erro: "Outra busca no ADN está em andamento. Tente em alguns minutos." };
  const e = j.empresas?.[0];
  if (!e) return { erro: "A busca não retornou resultado." };
  if (e.erro) return { erro: `Falha na busca: ${e.erro}` };
  if (!e.novos && !e.repetidos) return { ok: true, mensagem: "Nenhuma nota nova encontrada no ADN para esta empresa." };
  return { ok: true, mensagem: `${e.novos ?? 0} nota(s) nova(s) do ADN; ${e.repetidos ?? 0} já estavam guardadas.` };
}
