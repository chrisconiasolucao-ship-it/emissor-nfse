import { dinheiro, lerValor } from "@/lib/money";
import { montarIdDps } from "./dps-id";
import { dataHoraBrasilia, el, esc, grupo } from "./xml";

/**
 * Monta o XML da DPS v1.00 (sem o grupo IBS/CBS, fora de escopo até 01/01/2027).
 * Regras aplicadas para emitente = prestador (tpEmit 1): nome e endereço do prestador não são
 * informados (vêm do cadastro nacional). Pontos marcados "validar na restrita" dependem das regras
 * de negócio da Sefin, que os XSDs não mostram.
 */
export const NS_NFSE = "http://www.sped.fazenda.gov.br/nfse";
export const VERSAO_DPS = "1.00";
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

export function montarDps(d: DadosDps): { xml: string; idDps: string } {
  const idDps = montarIdDps(d.prestador.codMunicipio, d.prestador.cnpj, d.serie, d.numero);
  const vServ = dinheiro(d.valores.valorServico);
  if (!lerValor(vServ).greaterThan(0)) throw new Error("valor do serviço precisa ser maior que zero");
  if (d.servico.descricao.trim().length === 0 || d.servico.descricao.length > 2000) {
    throw new Error("descrição do serviço precisa ter de 1 a 2000 caracteres");
  }
  if (d.valores.issRetido && !d.valores.aliquotaIss) throw new Error("ISS retido exige alíquota");

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
    (d.prestador.opSimpNac === 3 ? el("regApTribSN", "1") : "") +
    el("regEspTrib", "0");

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
    grupo(
      "serv",
      grupo("locPrest", el("cLocPrestacao", d.servico.codMunicipioPrestacao)) +
        grupo(
          "cServ",
          el("cTribNac", d.servico.codigoTributacaoNacional) + el("xDescServ", d.servico.descricao) + el("cNBS", d.servico.codigoNbs),
        ),
    ) +
    grupo(
      "valores",
      grupo("vServPrest", el("vServ", vServ)) +
        grupo("trib", grupo("tribMun", tribMun) + grupo("totTrib", el("indTotTrib", "0"))),
    );

  const xml = `<DPS xmlns="${NS_NFSE}" versao="${VERSAO_DPS}"><infDPS Id="${esc(idDps)}">${infDps}</infDPS></DPS>`;
  return { xml, idDps };
}
