/**
 * Smoke na PRODUÇÃO RESTRITA (AT-001, AT-004, AT-015). Roda contra o Preview da Vercel ligado ao
 * branch `teste` do Supabase, com uma empresa de teste que já tem certificado A1 enviado pela tela.
 *
 *   npm run smoke:restrita
 *
 * Variáveis: TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_ROLE_KEY, SMOKE_APP_URL (URL do Preview),
 * WORKER_SECRET, SMOKE_EMPRESA_ID, SMOKE_ADMIN_USUARIO_ID (admin do cliente dessa empresa),
 * SMOKE_TOMADOR_CPF (opcional), NFSE_AMBIENTE=restrita, SEFIN_BASE_URL (restrita), CERT_MASTER_KEY.
 * Recusa rodar se qualquer coisa apontar para produção.
 */
import { createClient } from "@supabase/supabase-js";
import { chaveMestra, decifrarArquivo, decifrarTexto, type Cifrado, type MetaCifra } from "../src/lib/crypto/cert-vault";
import { abrirPfx } from "../src/lib/crypto/pfx";
import { montarPedidoCancelamento } from "../src/lib/nfse/evento-builder";
import { SefinClient, agenteMtls, transporteHttps } from "../src/lib/nfse/sefin-client";
import { assinarXml } from "../src/lib/nfse/xml-signer";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`falta a variável ${k}`);
  return v;
};
const passo = (n: number, t: string) => console.log(`\n[${n}] ${t}`);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (env("NFSE_AMBIENTE") !== "restrita" || !/producaorestrita/.test(env("SEFIN_BASE_URL"))) {
    throw new Error("o smoke só roda na produção restrita (NFSE_AMBIENTE=restrita e SEFIN_BASE_URL da restrita)");
  }
  const prod = process.env.PROD_SUPABASE_URL;
  if (prod && env("TEST_SUPABASE_URL") === prod) throw new Error("TEST_SUPABASE_URL é o banco principal");

  const db = createClient(env("TEST_SUPABASE_URL"), env("TEST_SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const empresaId = env("SMOKE_EMPRESA_ID");
  const admin = env("SMOKE_ADMIN_USUARIO_ID");

  passo(1, "empresa, município e certificado");
  const { data: emp, error } = await db.from("empresa").select("cnpj, cod_municipio, regime, pausada").eq("id", empresaId).single();
  if (error || !emp) throw new Error(`empresa: ${error?.message}`);
  if (emp.pausada) throw new Error("empresa está pausada (certificado?)");
  const { data: mun } = await db.from("municipio_situacao").select("nome, emissor_nacional, ativo_operacional").eq("cod_ibge", emp.cod_municipio).single();
  console.log(`  ${emp.cnpj} · ${emp.regime} · ${mun?.nome} · emissor nacional: ${mun?.emissor_nacional ? "sim" : "não (AT-001: deve emitir mesmo assim)"}`);

  passo(2, "rascunho → fila");
  const cpf = process.env.SMOKE_TOMADOR_CPF ?? "52998224725";
  const { data: tom } = await db.from("tomador").upsert({ empresa_id: empresaId, tipo_documento: "CPF", documento: cpf, nome: "TOMADOR SMOKE RESTRITA" }, { onConflict: "empresa_id,tipo_documento,documento" }).select("id").single();
  const competencia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(new Date()) + "-01";
  const { data: nota, error: e2 } = await db
    .from("nota")
    .insert({ empresa_id: empresaId, situacao: "na_fila", tomador_id: tom!.id, descricao: `Smoke produção restrita ${new Date().toISOString()}`, valor_servico: "1.00", competencia, codigo_tributacao_nacional: "010601", codigo_nbs: "113032000", cod_municipio_prestacao: emp.cod_municipio, criado_por: admin })
    .select("id")
    .single();
  if (e2 || !nota) throw new Error(`nota: ${e2?.message}`);
  console.log(`  nota ${nota.id}`);

  passo(3, "worker de emissão (AT-004: DPS assinada aceita pela Sefin)");
  let situacao = "na_fila";
  for (let i = 0; i < 10 && ["na_fila", "enviando"].includes(situacao); i++) {
    const r = await fetch(`${env("SMOKE_APP_URL")}/api/worker/emitir`, { method: "POST", headers: { "x-worker-secret": env("WORKER_SECRET") } });
    console.log(`  worker: HTTP ${r.status}`);
    await esperar(3000);
    const { data } = await db.from("nota").select("situacao, motivo_rejeicao, chave_acesso, documento_id, danfse_documento_id").eq("id", nota.id).single();
    situacao = data!.situacao;
    if (situacao === "rejeitada") throw new Error(`REJEITADA: ${data!.motivo_rejeicao}`);
    if (situacao === "autorizada") console.log(`  AUTORIZADA · chave ${data!.chave_acesso} · XML ${data!.documento_id ? "guardado" : "FALTANDO"} · DANFSe ${data!.danfse_documento_id ? "guardado" : "baixar depois"}`);
  }
  if (situacao !== "autorizada") throw new Error(`a nota não foi autorizada (situação ${situacao})`);

  passo(4, "cancelamento pelo admin do cliente (AT-015)");
  const { data: n } = await db.from("nota").select("chave_acesso").eq("id", nota.id).single();
  const { data: cert } = await db.from("certificado").select("storage_path, pfx_cripto, senha_cripto").eq("empresa_id", empresaId).eq("ativo", true).single();
  const arq = await db.storage.from("certificados").download(cert!.storage_path);
  const chave = chaveMestra(env("CERT_MASTER_KEY"));
  const pfx = decifrarArquivo(Buffer.from(await arq.data!.arrayBuffer()), cert!.pfx_cripto as MetaCifra, chave);
  const senha = decifrarTexto(cert!.senha_cripto as Cifrado, chave);
  const aberto = abrirPfx(pfx, senha);
  const pedido = montarPedidoCancelamento({ ambiente: "restrita", cnpjAutor: emp.cnpj, chaveAcesso: n!.chave_acesso!, codigoMotivo: "1", motivo: "Teste de cancelamento na produção restrita", em: new Date() });
  const sefin = new SefinClient(env("SEFIN_BASE_URL"), transporteHttps(agenteMtls(pfx, senha)));
  const ev = await sefin.registrarEvento(n!.chave_acesso!, assinarXml(pedido.xml, "infPedReg", aberto.chavePrivadaPem, aberto.certificadoPem));
  if (ev.tipo === "rejeitado") throw new Error(`cancelamento recusado: ${ev.mensagem}`);
  const { error: e3 } = await db.rpc("fn_registrar_evento", { p_empresa_id: empresaId, p_nota_id: nota.id, p_tipo: "cancelamento", p_codigo_motivo: "1", p_motivo: "Teste de cancelamento na produção restrita", p_quem: admin, p_protocolo: pedido.id, p_documento_id: null, p_nota_substituta_id: null, p_ip: null });
  if (e3) throw new Error(`registro do evento: ${e3.message}`);
  const { data: aviso } = await db.from("aviso").select("mensagem").eq("nota_id", nota.id).eq("tipo", "cancelamento").maybeSingle();
  console.log(`  cancelada · aviso ao escritório: ${aviso ? aviso.mensagem : "NÃO GERADO"}`);
  if (!aviso) throw new Error("aviso do cancelamento não foi criado");
  console.log("\nSMOKE OK");
}

main().catch((e) => {
  console.error(`\nSMOKE FALHOU: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
