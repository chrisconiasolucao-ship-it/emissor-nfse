import { XMLParser } from "fast-xml-parser";
import { dinheiro } from "@/lib/money";

/**
 * Lê o XML de uma NFS-e (autorizada ou baixada do ADN) e devolve o que serve de modelo para uma
 * nova nota (AT-019). Valores ficam como texto (parseTagValue: false) e passam por money.ts.
 */
export type ModeloNota = {
  chaveAcesso: string | null;
  numeroNfse: string | null;
  emitidaEm: string | null;
  competencia: string | null;
  prestadorCnpj: string | null;
  tomador: {
    tipoDocumento: "CPF" | "CNPJ" | "EXTERIOR";
    documento: string;
    nome: string;
    email: string | null;
    endereco: { codMunicipio: string; cep: string; logradouro: string; numero: string; complemento: string | null; bairro: string } | null;
  } | null;
  servico: { codigoTributacaoNacional: string; codigoNbs: string | null; descricao: string; codMunicipioPrestacao: string | null };
  valorServico: string;
  issRetido: boolean;
  aliquotaIss: string | null;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

type No = Record<string, unknown>;
const no = (x: unknown): No => (x && typeof x === "object" ? (x as No) : {});
const txt = (x: unknown): string | null => (x == null || typeof x === "object" ? null : String(x));

export function lerNfse(xml: string): ModeloNota {
  const raiz = no(parser.parse(xml));
  const nfse = no(raiz.NFSe);
  const inf = no(nfse.infNFSe);
  // NFS-e completa traz a DPS dentro de infNFSe; aceitamos também uma DPS solta.
  const infDps = no(no(inf.DPS ?? raiz.DPS).infDPS);
  if (Object.keys(infDps).length === 0) throw new Error("XML não é uma NFS-e nem uma DPS do padrão nacional");

  const idNfse = txt(inf["@Id"]);
  const toma = no(infDps.toma);
  const end = no(toma.end);
  const endNac = no(end.endNac);
  const tipoDoc = toma.CNPJ ? "CNPJ" : toma.CPF ? "CPF" : toma.NIF || toma.cNaoNIF ? "EXTERIOR" : null;
  const serv = no(infDps.serv);
  const cServ = no(serv.cServ);
  const tribMun = no(no(no(infDps.valores).trib).tribMun);
  const vServ = txt(no(no(infDps.valores).vServPrest).vServ);
  if (!vServ) throw new Error("NFS-e sem valor do serviço");
  const cTribNac = txt(cServ.cTribNac);
  if (!cTribNac) throw new Error("NFS-e sem código de tributação nacional");

  const dCompet = txt(infDps.dCompet);
  return {
    chaveAcesso: idNfse ? idNfse.replace(/^NFS/, "") : null,
    numeroNfse: txt(inf.nNFSe),
    emitidaEm: txt(inf.dhProc) ?? txt(infDps.dhEmi),
    competencia: dCompet ? `${dCompet.slice(0, 7)}-01` : null,
    prestadorCnpj: txt(no(infDps.prest).CNPJ),
    tomador: tipoDoc
      ? {
          tipoDocumento: tipoDoc,
          documento: txt(toma.CNPJ) ?? txt(toma.CPF) ?? txt(toma.NIF) ?? "",
          nome: txt(toma.xNome) ?? "",
          email: txt(toma.email),
          endereco:
            endNac.cMun && end.xLgr
              ? {
                  codMunicipio: txt(endNac.cMun) ?? "",
                  cep: txt(endNac.CEP) ?? "",
                  logradouro: txt(end.xLgr) ?? "",
                  numero: txt(end.nro) ?? "",
                  complemento: txt(end.xCpl),
                  bairro: txt(end.xBairro) ?? "",
                }
              : null,
        }
      : null,
    servico: {
      codigoTributacaoNacional: cTribNac,
      codigoNbs: txt(cServ.cNBS),
      descricao: txt(cServ.xDescServ) ?? "",
      codMunicipioPrestacao: txt(no(serv.locPrest).cLocPrestacao),
    },
    valorServico: dinheiro(vServ),
    issRetido: txt(tribMun.tpRetISSQN) === "2",
    aliquotaIss: txt(tribMun.pAliq),
  };
}
