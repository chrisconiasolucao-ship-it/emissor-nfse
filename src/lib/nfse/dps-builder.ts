import { dinheiro, lerValor } from "@/lib/money";
import { montarIdDps } from "./dps-id";
import { lerPercentual, tipoRetPisCofins, valoresRetencao, type PercentuaisRetencao } from "./retencoes";
import { dataHoraBrasilia, el, esc, grupo } from "./xml";

/**
 * Monta o XML da DPS v1.01 (esquema da produção restrita de 24/11/2026; sem o grupo IBS/CBS, opcional no esquema).
 * Regras aplicadas para emitente = prestador (tpEmit 1): nome e endereço do prestador não são
 * informados (vêm do cadastro nacional). Pontos marcados "validar na restrita" dependem das regras
 * de negócio da Sefin, que os XSDs não mostram.
 */
export const NS_NFSE = "http://www.sped.fazenda.gov.br/nfse";
export const VERSAO_DPS = "1.01";
export const VER_APLIC = "CHRISCON-1.0";

export type DadosDps = {
  ambiente: "restrita" | "producao";
  emitidaEm: Date;
  serie: string;
  numero: bigint | number;
  competencia: string; // AAAA-MM-DD
  prestador: {
    cnpj: string;
    codMunicipio: string;
    opSimpNac: 2 | 3;
    aliquotaSimples?: string | null; // pTotTribSN (%), obrigatória para ME/EPP
    /** sociedade_profissionais = ISS fixo: regEspTrib 6, sem alíquota e sem ISS retido */
    regimeIss?: "normal" | "sociedade_profissionais" | null;
    inscricaoMunicipal?: string | null;
    telefone?: string | null;
    email?: string | null;
  };
  tomador: {
    tipoDocumento: "CPF" | "CNPJ";
    documento: string;
    nome: string;
    email?: string | null;
    telefone?: string | null;
    endereco?: { codMunicipio: string; cep: string; logradouro: string; numero: string; complemento?: string | null; bairro: string } | null;
  };
  servico: {
    codMunicipioPrestacao: string;
    codigoTributacaoNacional: string;
    codigoNbs?: string | null;
    descricao: string;
  };
  valores: {
    valorServico: string;
    issRetido: boolean;
    aliquotaIss?: string | null; // obrigatória quando retido
    /** percentuais retidos pelo tomador sobre o valor do serviço */
    retencoes?: PercentuaisRetencao | null;
  };
  substituicao?: { chaveSubstituida: string; codigoMotivo: "01" | "02" | "03" | "04" | "05" | "99"; motivo?: string | null } | null;
};

const so = (s: string) => s.replace(/\D/g, "");

function aliquotaXml(a: string): string {
  const v = lerValor(a);
  if (v.lessThan(0) || v.greaterThanOrEqualTo(10) || v.decimalPlaces() > 2) {
    throw new Error("alíquota do ISS precisa ter até 2 casas e ser menor que 10%");
  }
  return lerValor(a).toFixed(2);
}

/**
 * totTrib: ME/EPP informa pTotTribSN (E0712 recusa indTotTrib para ME/EPP); MEI informa indTotTrib = 0.
 */
export function totalTributos(p: DadosDps["prestador"]): string {
  if (p.opSimpNac === 2) return el("indTotTrib", "0");
  if (p.aliquotaSimples === null || p.aliquotaSimples === undefined || p.aliquotaSimples === "") {
    throw new ErroCadastroDps("ME/EPP precisa da alíquota do Simples Nacional (%) no cadastro da empresa para emitir.");
  }
  const v = lerValor(p.aliquotaSimples);
  if (v.lessThan(0) || v.greaterThanOrEqualTo(100) || v.decimalPlaces() > 2) throw new ErroCadastroDps("alíquota do Simples precisa ser de 0 a 99,99%");
  return el("pTotTribSN", lerValor(p.aliquotaSimples).toFixed(2));
}

export class ErroCadastroDps extends Error {}

/** ISS fixo no Simples (ex.: escritório contábil, LC 123 art. 18 §22-A): federais no SN, ISS por fora (validar na restrita). */
export const REG_AP_TRIB_SN_ISS_FIXO = "2";
/** CST do PIS/COFINS no grupo de retenção: optante do Simples não apura PIS/COFINS fora do DAS (validar na restrita). */
export const CST_PIS_COFINS_SIMPLES = "00";

/** Grupo tribFed (retenções federais) ou "" quando não há retenção. */
export function tributosFederais(valorServico: string, bruto: PercentuaisRetencao | null | undefined): string {
  if (!bruto) return "";
  // "1.5" do banco vira "1.50" (o esquema pede 2 casas)
  const pct: PercentuaisRetencao = {};
  for (const [t, v] of Object.entries(bruto)) if (v) pct[t as keyof PercentuaisRetencao] = lerPercentual(v);
  const v = valoresRetencao(valorServico, pct);
  const pis = Boolean(pct.pis), cofins = Boolean(pct.cofins), csll = Boolean(pct.csll);
  const piscofins =
    pis || cofins || csll
      ? grupo(
          "piscofins",
          el("CST", CST_PIS_COFINS_SIMPLES) +
            (pis || cofins ? el("vBCPisCofins", valorServico) : "") +
            (pis ? el("pAliqPis", pct.pis!) : "") +
            (cofins ? el("pAliqCofins", pct.cofins!) : "") +
            (pis ? el("vPis", v.pis) : "") +
            (cofins ? el("vCofins", v.cofins) : "") +
            el("tpRetPisCofins", tipoRetPisCofins(pis, cofins, csll)),
        )
      : "";
  const corpo =
    piscofins +
    (pct.inss ? el("vRetCP", v.inss) : "") +
    (pct.irrf ? el("vRetIRRF", v.irrf) : "") +
    (csll ? el("vRetCSLL", v.csll) : "");
  return corpo ? grupo("tribFed", corpo) : "";
}

export function montarDps(d: DadosDps): { xml: string; idDps: string } {
  const idDps = montarIdDps(d.prestador.codMunicipio, d.prestador.cnpj, d.serie, d.numero);
  const vServ = dinheiro(d.valores.valorServico);
  if (!lerValor(vServ).greaterThan(0)) throw new Error("valor do serviço precisa ser maior que zero");
  if (d.servico.descricao.trim().length === 0 || d.servico.descricao.length > 2000) {
    throw new Error("descrição do serviço precisa ter de 1 a 2000 caracteres");
  }
  if (d.valores.issRetido && !d.valores.aliquotaIss) throw new Error("ISS retido exige alíquota");
  const issFixo = d.prestador.regimeIss === "sociedade_profissionais";
  if (issFixo && d.valores.issRetido) {
    throw new ErroCadastroDps("Empresa com ISS fixo (sociedade de profissionais) não tem ISS retido pelo tomador. Desmarque o ISS retido.");
  }
  const totTrib = totalTributos(d.prestador);

  const t = d.tomador;
  const endToma = t.endereco
    ? grupo(
        "end",
        grupo("endNac", el("cMun", t.endereco.codMunicipio) + el("CEP", so(t.endereco.cep))) +
          el("xLgr", t.endereco.logradouro) +
          el("nro", t.endereco.numero) +
          el("xCpl", t.endereco.complemento) +
          el("xBairro", t.endereco.bairro),
      )
    : "";

  const subst = d.substituicao
    ? grupo(
        "subst",
        el("chSubstda", d.substituicao.chaveSubstituida) +
          el("cMotivo", d.substituicao.codigoMotivo) +
          el("xMotivo", d.substituicao.motivo),
      )
    : "";

  const regTrib =
    el("opSimpNac", String(d.prestador.opSimpNac)) +
    // ME/EPP: apuração de tributos federais e municipal pelo Simples (validar na restrita)
    (d.prestador.opSimpNac === 3 ? el("regApTribSN", issFixo ? REG_AP_TRIB_SN_ISS_FIXO : "1") : "") +
    el("regEspTrib", issFixo ? "6" : "0");

  const tribMun =
    el("tribISSQN", "1") +
    el("tpRetISSQN", d.valores.issRetido ? "2" : "1") +
    (d.valores.issRetido && d.valores.aliquotaIss ? el("pAliq", aliquotaXml(d.valores.aliquotaIss)) : "");

  const infDps =
    el("tpAmb", d.ambiente === "producao" ? "1" : "2") +
    el("dhEmi", dataHoraBrasilia(d.emitidaEm)) +
    el("verAplic", VER_APLIC) +
    el("serie", d.serie) +
    el("nDPS", BigInt(d.numero).toString()) +
    el("dCompet", d.competencia) +
    el("tpEmit", "1") +
    el("finNFSe", "0") + // NFS-e regular (v1.01, reforma tributária)
    el("cLocEmi", d.prestador.codMunicipio) +
    subst +
    grupo(
      "prest",
      el("CNPJ", d.prestador.cnpj) +
        el("IM", d.prestador.inscricaoMunicipal) +
        el("fone", d.prestador.telefone ? so(d.prestador.telefone) : null) +
        el("email", d.prestador.email) +
        grupo("regTrib", regTrib),
    ) +
    grupo(
      "toma",
      el(t.tipoDocumento, so(t.documento)) +
        el("xNome", t.nome) +
        endToma +
        el("fone", t.telefone ? so(t.telefone) : null) +
        el("email", t.email),
    ) +
    el("indDest", "0") + // destinatário = o próprio tomador (v1.01)
    grupo(
      "serv",
      grupo("locPrest", el("cLocPrestacao", d.servico.codMunicipioPrestacao)) +
        grupo(
          "cServ",
          el("cTribNac", d.servico.codigoTributacaoNacional) + el("cNBS", d.servico.codigoNbs) + el("xDescServ", d.servico.descricao),
        ),
    ) +
    grupo(
      "valores",
      grupo("vServPrest", el("vServ", vServ)) +
        grupo("trib", grupo("tribMun", tribMun) + tributosFederais(vServ, d.valores.retencoes) + grupo("totTrib", totTrib)),
    );

  const xml = `<DPS xmlns="${NS_NFSE}" versao="${VERSAO_DPS}"><infDPS Id="${esc(idDps)}">${infDps}</infDPS></DPS>`;
  return { xml, idDps };
}
