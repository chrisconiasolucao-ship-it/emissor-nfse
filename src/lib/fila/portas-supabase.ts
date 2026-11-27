import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { auditar, logSeguranca } from "@/lib/auditoria/audit";
import { config } from "@/lib/config";
import { chaveMestra, decifrarArquivo, decifrarTexto, type Cifrado, type MetaCifra } from "@/lib/crypto/cert-vault";
import { abrirPfx, exigirValido } from "@/lib/crypto/pfx";
import { SefinClient, agenteMtls, transporteHttps } from "@/lib/nfse/sefin-client";
import { SemCertificado, type ContextoNota, type NotaNaFila, type Portas } from "./worker";

/**
 * Implementação real das portas do worker: banco e Storage do Supabase (service role) e Sefin com mTLS.
 * Arquivo fora do manifest do DESIGN (registrado no BUILD_REPORT): separa o adaptador da regra do worker.
 */
type Linha = Record<string, unknown>;
const s = (v: unknown) => (v == null ? null : String(v));

async function rpc(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

export function notaDaFila(l: Linha): NotaNaFila {
  return {
    empresaId: String(l.empresa_id),
    id: String(l.id),
    idDps: String(l.id_dps),
    serieDps: String(l.serie_dps),
    numeroDps: BigInt(String(l.numero_dps)),
    tentativas: Number.parseInt(String(l.tentativas ?? 0), 10),
  };
}

/** Baixa o pfx cifrado, decifra com a chave fora do banco e confere validade (AT-007, AT-011, AT-013). */
export async function abrirCertificadoDaEmpresa(db: SupabaseClient, empresaId: string) {
  const c = config();
  const { data: cert, error } = await db
    .from("certificado")
    .select("storage_path, pfx_cripto, senha_cripto, sha256")
    .eq("empresa_id", empresaId)
    .eq("ativo", true)
    .maybeSingle();
  if (error) throw new Error(`não leu o certificado: ${error.message}`);
  if (!cert) throw new SemCertificado();
  const arq = await db.storage.from("certificados").download(String(cert.storage_path));
  if (arq.error || !arq.data) throw new Error(`não baixou o certificado: ${arq.error?.message ?? "vazio"}`);
  const chave = chaveMestra(c.CERT_MASTER_KEY);
  const pfx = decifrarArquivo(Buffer.from(await arq.data.arrayBuffer()), cert.pfx_cripto as MetaCifra, chave);
  // o AES-GCM já recusa arquivo adulterado; o SHA-256 gravado é o do certificado (DER) que foi enviado
  const senha = decifrarTexto(cert.senha_cripto as Cifrado, chave);
  const aberto = abrirPfx(pfx, senha);
  if (aberto.sha256 !== String(cert.sha256).trim()) {
    throw new Error("o certificado guardado no Storage não é o que foi enviado (SHA-256 diferente)");
  }
  return { pfx, senha, aberto: exigirValido(aberto) };
}

export function portasSupabase(db: SupabaseClient, dono: string): Portas {
  const c = config();
  return {
    agora: () => new Date(),
    ambiente: c.NFSE_AMBIENTE,
    retryMinutos: c.RETRY_MINUTOS,

    async pegarProximaNota() {
      const data = (await rpc(db, "fn_pegar_proxima_nota", {})) as Linha[] | Linha | null;
      const l = Array.isArray(data) ? data[0] : data;
      return l && l.id ? notaDaFila(l) : null;
    },

    async carregarContexto(n): Promise<ContextoNota> {
      const { data: nota, error } = await db
        .from("nota")
        .select("*, empresa:empresa_id(cnpj, cod_municipio, op_simp_nac, inscricao_municipal, aliquota_simples, regime_iss), tomador:tomador(*)")
        .eq("empresa_id", n.empresaId)
        .eq("id", n.id)
        .single();
      if (error || !nota) throw new Error(`não leu a nota ${n.id}: ${error?.message}`);
      const e = nota.empresa as Linha;
      const t = nota.tomador as Linha;
      let substitui: ContextoNota["substitui"] = null;
      if (nota.nota_substituida_id) {
        const { data: antiga } = await db.from("nota").select("chave_acesso").eq("empresa_id", n.empresaId).eq("id", nota.nota_substituida_id).single();
        if (!antiga?.chave_acesso) throw new Error("nota substituída sem chave de acesso");
        substitui = {
          notaId: String(nota.nota_substituida_id),
          chave: String(antiga.chave_acesso),
          codigoMotivo: String(nota.codigo_motivo_substituicao) as NonNullable<ContextoNota["substitui"]>["codigoMotivo"],
          motivo: String(nota.motivo_substituicao),
          pedidoPor: String(nota.criado_por),
        };
      }
      const { data: mun } = await db.from("municipio_situacao").select("*").eq("cod_ibge", e.cod_municipio).maybeSingle();
      return {
        empresa: {
          cnpj: String(e.cnpj),
          codMunicipio: String(e.cod_municipio),
          opSimpNac: Number.parseInt(String(e.op_simp_nac), 10) === 2 ? 2 : 3,
          inscricaoMunicipal: s(e.inscricao_municipal),
          aliquotaSimples: e.aliquota_simples === null || e.aliquota_simples === undefined ? null : String(e.aliquota_simples),
          regimeIss: e.regime_iss === "sociedade_profissionais" ? "sociedade_profissionais" : "normal",
        },
        municipio: mun
          ? { codIbge: String(mun.cod_ibge), nome: String(mun.nome), uf: String(mun.uf), ativoOperacional: Boolean(mun.ativo_operacional), emissorNacional: Boolean(mun.emissor_nacional) }
          : null,
        competencia: String(nota.competencia),
        substitui,
        dados: {
          tomador: {
            tipoDocumento: t.tipo_documento === "CNPJ" ? "CNPJ" : "CPF",
            documento: String(t.documento),
            nome: String(t.nome),
            email: s(t.email),
            telefone: s(t.telefone),
            endereco:
              t.cep && t.cod_municipio && t.logradouro
                ? { codMunicipio: String(t.cod_municipio), cep: String(t.cep), logradouro: String(t.logradouro), numero: s(t.numero) ?? "S/N", complemento: s(t.complemento), bairro: s(t.bairro) ?? "NÃO INFORMADO" }
                : null,
          },
          servico: {
            codMunicipioPrestacao: s(nota.cod_municipio_prestacao) ?? String(e.cod_municipio),
            codigoTributacaoNacional: String(nota.codigo_tributacao_nacional),
            codigoNbs: s(nota.codigo_nbs),
            descricao: String(nota.descricao),
          },
          valores: {
            valorServico: String(nota.valor_servico),
            issRetido: Boolean(nota.iss_retido),
            aliquotaIss: s(nota.aliquota_iss),
            retencoes: { inss: s(nota.pct_ret_inss), irrf: s(nota.pct_ret_irrf), csll: s(nota.pct_ret_csll), pis: s(nota.pct_ret_pis), cofins: s(nota.pct_ret_cofins) },
          },
        },
      };
    },

    abrirCertificado: (empresaId) => abrirCertificadoDaEmpresa(db, empresaId),

    sefin(cert) {
      return new SefinClient(c.SEFIN_BASE_URL, transporteHttps(agenteMtls(cert.pfx, cert.senha)));
    },

    async nomeMunicipio(cod) {
      const { data } = await db.from("municipio_situacao").select("nome, uf").eq("cod_ibge", cod).maybeSingle();
      return data ? `${String(data.nome)} / ${String(data.uf)}` : null;
    },

    async guardarDocumento(n, tipo, conteudo, contentType) {
      const hash = createHash("sha256").update(conteudo).digest("hex");
      const ext = tipo === "danfse" ? "pdf" : "xml";
      const caminho = `${n.empresaId}/notas/${n.id}/${tipo}-${hash.slice(0, 12)}.${ext}`;
      const up = await db.storage.from("documentos").upload(caminho, conteudo, { contentType, upsert: false });
      if (up.error && !/exists|duplicate/i.test(up.error.message)) throw new Error(`Storage: ${up.error.message}`);
      const ja = await db.from("documento").select("id").eq("empresa_id", n.empresaId).eq("tipo", tipo).eq("sha256", hash).maybeSingle();
      if (ja.data) return String(ja.data.id);
      const { data, error } = await db
        .from("documento")
        .insert({ empresa_id: n.empresaId, tipo, storage_path: caminho, sha256: hash, tamanho: conteudo.length, content_type: contentType, nota_id: n.id })
        .select("id")
        .single();
      if (error) throw new Error(`documento: ${error.message}`);
      return String(data.id);
    },

    async reagendar(n, erro) {
      return String(await rpc(db, "fn_reagendar", { p_empresa_id: n.empresaId, p_id: n.id, p_erro: erro, p_minutos: c.RETRY_MINUTOS }));
    },
    async marcarRejeitada(n, codigo, motivo) {
      await rpc(db, "fn_marcar_rejeitada", { p_empresa_id: n.empresaId, p_id: n.id, p_codigo: codigo, p_motivo: motivo });
    },
    async marcarAutorizada(n, a) {
      await rpc(db, "fn_marcar_autorizada", {
        p_empresa_id: n.empresaId,
        p_id: n.id,
        p_chave: a.chave,
        p_numero_nfse: a.numeroNfse,
        p_autorizada_em: new Date().toISOString(),
        p_documento_id: a.documentoId,
        p_danfse_documento_id: a.danfseDocumentoId,
      });
    },
    async pausarEmpresa(empresaId, motivo) {
      await rpc(db, "fn_pausar_empresa", { p_empresa_id: empresaId, p_motivo: motivo });
    },
    async devolverParaFila(n) {
      await rpc(db, "fn_devolver_para_fila", { p_empresa_id: n.empresaId, p_id: n.id });
    },
    async registrarUsoCertificado(n, cert) {
      await logSeguranca(db, { evento: "uso_certificado", empresaId: n.empresaId, alvo: n.id, detalhe: { certificado_sha256: cert.sha256, id_dps: n.idDps, worker: dono } });
      await auditar(db, { empresaId: n.empresaId, acao: "uso_certificado", entidade: "nota", entidadeId: n.id, depois: { certificado_sha256: cert.sha256, id_dps: n.idDps } });
    },
    async registrarSubstituicao(n, sub) {
      await rpc(db, "fn_registrar_evento", {
        p_empresa_id: n.empresaId,
        p_nota_id: sub.notaId,
        p_tipo: "substituicao",
        p_codigo_motivo: sub.codigoMotivo,
        p_motivo: sub.motivo,
        p_quem: sub.pedidoPor,
        p_protocolo: null,
        p_documento_id: null,
        p_nota_substituta_id: n.id,
        p_ip: null,
      });
    },
    async auditar(n, acao, depois) {
      await auditar(db, { empresaId: n.empresaId, acao, entidade: "nota", entidadeId: n.id, depois });
    },
  };
}
