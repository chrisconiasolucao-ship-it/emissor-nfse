import { CertificadoVencido, SenhaCertificadoInvalida, type CertificadoAberto } from "@/lib/crypto/pfx";
import { gerarDanfse, type NomeMunicipio } from "@/lib/nfse/danfse";
import { ErroCadastroDps, montarDps, totalTributos, type DadosDps } from "@/lib/nfse/dps-builder";
import { ErroTecnicoSefin } from "@/lib/nfse/erros-sefin";
import { lerNfse } from "@/lib/nfse/nfse-parser";
import { avaliarRegraMunicipio, type SituacaoMunicipio } from "@/lib/nfse/regra-municipio";
import type { ResultadoEmissao } from "@/lib/nfse/sefin-client";
import { assinarXml } from "@/lib/nfse/xml-signer";
import { decidir } from "./retry";

/**
 * Worker de emissão (AT-005 a AT-008, AT-012; Decision 4). Uma nota por vez, até acabar a fila ou o
 * orçamento de tempo. Tudo que fala com banco, Storage e Sefin entra por `Portas`, para o teste
 * unitário e para a rota usarem o mesmo código.
 */
export type NotaNaFila = {
  empresaId: string;
  id: string;
  idDps: string;
  serieDps: string;
  numeroDps: bigint;
  tentativas: number;
};

export type ContextoNota = {
  empresa: { cnpj: string; codMunicipio: string; opSimpNac: 2 | 3; inscricaoMunicipal?: string | null; aliquotaSimples?: string | null };
  municipio: SituacaoMunicipio | null;
  competencia: string;
  dados: Omit<DadosDps, "ambiente" | "emitidaEm" | "serie" | "numero" | "competencia" | "prestador">;
  /** nota substituída (a NFS-e nova leva o grupo subst; depois de autorizada, registra o evento) */
  substitui?: { notaId: string; chave: string; codigoMotivo: "01" | "02" | "03" | "04" | "05" | "99"; motivo: string; pedidoPor: string } | null;
};

export type CertificadoEmUso = { pfx: Buffer; senha: string; aberto: CertificadoAberto };

export type ClienteSefin = {
  consultarDps(idDps: string): Promise<string | null>;
  emitir(dpsAssinada: string): Promise<ResultadoEmissao>;
  baixarNfse(chave: string): Promise<string>;
};

export type Portas = {
  agora(): Date;
  ambiente: "restrita" | "producao";
  retryMinutos: number[];
  pegarProximaNota(): Promise<NotaNaFila | null>;
  carregarContexto(n: NotaNaFila): Promise<ContextoNota>;
  /** Lança SenhaCertificadoInvalida, CertificadoVencido ou SemCertificado. */
  abrirCertificado(empresaId: string): Promise<CertificadoEmUso>;
  sefin(cert: CertificadoEmUso): ClienteSefin;
  guardarDocumento(n: NotaNaFila, tipo: "xml_autorizado" | "danfse", conteudo: Buffer, contentType: string): Promise<string>;
  reagendar(n: NotaNaFila, erro: string): Promise<string>;
  marcarRejeitada(n: NotaNaFila, codigo: string, motivo: string): Promise<void>;
  marcarAutorizada(n: NotaNaFila, a: { chave: string; numeroNfse: string | null; documentoId: string; danfseDocumentoId: string | null }): Promise<void>;
  pausarEmpresa(empresaId: string, motivo: string): Promise<void>;
  devolverParaFila(n: NotaNaFila): Promise<void>;
  registrarUsoCertificado(n: NotaNaFila, cert: CertificadoAberto): Promise<void>;
  auditar(n: NotaNaFila, acao: string, depois: Record<string, unknown>): Promise<void>;
  registrarSubstituicao(n: NotaNaFila, s: NonNullable<ContextoNota["substitui"]>): Promise<void>;
  /** Nome "Município / UF" pelo código IBGE, para o DANFSe. */
  nomeMunicipio?: NomeMunicipio;
};

export class SemCertificado extends Error {
  constructor() {
    super("Empresa sem certificado A1 ativo");
  }
}

export type Resultado =
  | { nota: string; resultado: "autorizada"; chave: string; reaproveitada: boolean }
  | { nota: string; resultado: "rejeitada"; codigo: string; motivo: string }
  | { nota: string; resultado: "nova_tentativa" | "desistiu"; detalhe: string }
  | { nota: string; resultado: "empresa_pausada"; motivo: string }
  | { nota: string; resultado: "erro_interno"; detalhe: string };

export async function processarNota(p: Portas, n: NotaNaFila): Promise<Resultado> {
  const ctx = await p.carregarContexto(n);

  // 1. regra de município: bloqueia sem enviar (AT-002, AT-003)
  const regra = avaliarRegraMunicipio({ opSimpNac: ctx.empresa.opSimpNac, competencia: ctx.competencia, municipio: ctx.municipio });
  if (!regra.permitido) {
    await p.marcarRejeitada(n, regra.codigo, regra.motivo);
    return { nota: n.id, resultado: "rejeitada", codigo: regra.codigo, motivo: regra.motivo };
  }
  // cadastro incompleto para a DPS (ex.: ME/EPP sem alíquota do Simples): rejeita sem usar o certificado
  try {
    totalTributos({ cnpj: ctx.empresa.cnpj, codMunicipio: ctx.empresa.codMunicipio, opSimpNac: ctx.empresa.opSimpNac, aliquotaSimples: ctx.empresa.aliquotaSimples });
  } catch (e) {
    if (!(e instanceof ErroCadastroDps)) throw e;
    await p.marcarRejeitada(n, "CADASTRO", e.message);
    return { nota: n.id, resultado: "rejeitada", codigo: "CADASTRO", motivo: e.message };
  }

  // 2. certificado: problema pausa a empresa inteira; a nota volta para a fila (AT-007)
  let cert: CertificadoEmUso;
  try {
    cert = await p.abrirCertificado(n.empresaId);
  } catch (e) {
    if (e instanceof SenhaCertificadoInvalida || e instanceof CertificadoVencido || e instanceof SemCertificado) {
      await p.pausarEmpresa(n.empresaId, e.message);
      await p.devolverParaFila(n);
      return { nota: n.id, resultado: "empresa_pausada", motivo: e.message };
    }
    throw e;
  }
  await p.registrarUsoCertificado(n, cert.aberto); // AT-012/AT-033: sem registro, não assina

  // 3. DPS e assinatura
  const { xml, idDps } = montarDps({
    ...ctx.dados,
    ambiente: p.ambiente,
    emitidaEm: p.agora(),
    serie: n.serieDps,
    numero: n.numeroDps,
    competencia: ctx.competencia,
    substituicao: ctx.substitui ? { chaveSubstituida: ctx.substitui.chave, codigoMotivo: ctx.substitui.codigoMotivo, motivo: ctx.substitui.motivo } : null,
    prestador: { cnpj: ctx.empresa.cnpj, codMunicipio: ctx.empresa.codMunicipio, opSimpNac: ctx.empresa.opSimpNac, inscricaoMunicipal: ctx.empresa.inscricaoMunicipal, aliquotaSimples: ctx.empresa.aliquotaSimples },
  });
  if (idDps !== n.idDps) throw new Error(`id da DPS montado (${idDps}) difere do numerado no banco (${n.idDps})`);
  const assinada = assinarXml(xml, "infDPS", cert.aberto.chavePrivadaPem, cert.aberto.certificadoPem);
  const sefin = p.sefin(cert);

  try {
    // 4. Decision 4: antes de enviar, pergunta se a DPS já virou NFS-e. Vale para toda nota, não só
    //    para a nova tentativa: uma nota devolvida por erro interno depois de autorizada (Storage fora,
    //    por exemplo) volta sem gastar tentativa e não pode ser enviada de novo.
    let nfseXml: string | null = null;
    let reaproveitada = false;
    let chave: string | null = await sefin.consultarDps(n.idDps);
    if (chave) {
      nfseXml = await sefin.baixarNfse(chave);
      reaproveitada = true;
    }
    if (!chave) {
      const r = await sefin.emitir(assinada);
      if (r.tipo === "rejeitada") {
        await p.marcarRejeitada(n, r.codigo, r.mensagem); // AT-006: sem nova tentativa
        return { nota: n.id, resultado: "rejeitada", codigo: r.codigo, motivo: r.mensagem };
      }
      chave = r.chaveAcesso;
      nfseXml = r.nfseXml;
    }

    // 5. autorizada: guarda XML e DANFSe. O DANFSe é gerado aqui a partir do XML (NT 008; a API oficial foi
    //    suspensa em 03/08/2026). Se falhar, a nota segue autorizada e o worker de DANFSe gera depois.
    const xmlDoc = await p.guardarDocumento(n, "xml_autorizado", Buffer.from(nfseXml!, "utf8"), "application/xml");
    let danfseDoc: string | null = null;
    try {
      danfseDoc = await p.guardarDocumento(n, "danfse", await gerarDanfse(nfseXml!, { nomeMunicipio: p.nomeMunicipio }), "application/pdf");
    } catch {
      danfseDoc = null;
    }
    let numeroNfse: string | null = null;
    try {
      numeroNfse = lerNfse(nfseXml!).numeroNfse;
    } catch {
      numeroNfse = null;
    }
    await p.marcarAutorizada(n, { chave, numeroNfse, documentoId: xmlDoc, danfseDocumentoId: danfseDoc });
    await p.auditar(n, "nota_autorizada", { chave_acesso: chave, numero_nfse: numeroNfse, reaproveitada });
    // a Sefin já marcou a antiga como substituída ao autorizar a nova; aqui o sistema acompanha (AT-015)
    if (ctx.substitui) await p.registrarSubstituicao(n, ctx.substitui);
    return { nota: n.id, resultado: "autorizada", chave, reaproveitada };
  } catch (e) {
    if (!(e instanceof ErroTecnicoSefin)) throw e;
    // 6. falha técnica: 5/15/60 min, depois Rejeitada "Receita indisponível" (AT-005)
    const d = decidir(n.tentativas, p.retryMinutos, p.agora(), e.detalhe);
    await p.reagendar(n, e.detalhe);
    return { nota: n.id, resultado: d.acao === "reagendar" ? "nova_tentativa" : "desistiu", detalhe: e.detalhe };
  }
}

/** Uma nota por vez até a fila esvaziar ou o orçamento acabar (AT-008). */
export async function rodarFila(p: Portas, orcamentoMs: number, mediaPorNotaMs = 8_000): Promise<Resultado[]> {
  const inicio = p.agora().getTime();
  const resultados: Resultado[] = [];
  while (p.agora().getTime() - inicio + mediaPorNotaMs <= orcamentoMs) {
    const n = await p.pegarProximaNota();
    if (!n) break;
    try {
      resultados.push(await processarNota(p, n));
    } catch (e) {
      // erro nosso (banco, Storage, código): a nota volta para a fila sem gastar tentativa
      await p.devolverParaFila(n).catch(() => undefined);
      resultados.push({ nota: n.id, resultado: "erro_interno", detalhe: e instanceof Error ? e.message : String(e) });
      break;
    }
  }
  return resultados;
}
