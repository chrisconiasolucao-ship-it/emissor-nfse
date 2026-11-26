import { dataHoraBrasilia, el, esc, grupo } from "./xml";
import { NS_NFSE, VERSAO_DPS, VER_APLIC } from "./dps-builder";

/**
 * Pedido de registro de evento (pedRegEvento v1.01): cancelamento (e101101).
 * A substituição no padrão nacional é feita emitindo uma nova DPS com o grupo <subst>; a Sefin
 * registra o evento 105102 sozinha. Id = "PRE" + chave(50) + tipo(6) (TSIdPedRefEvt, 59 posições).
 */
export const TIPO_CANCELAMENTO = "101101";
export type CodigoCancelamento = "1" | "2" | "9"; // erro na emissão · serviço não prestado · outros

export function montarPedidoCancelamento(a: {
  ambiente: "restrita" | "producao";
  cnpjAutor: string;
  chaveAcesso: string;
  codigoMotivo: CodigoCancelamento;
  motivo: string;
  em: Date;
}): { xml: string; id: string } {
  if (!/^\d{50}$/.test(a.chaveAcesso)) throw new Error("chave de acesso inválida");
  const motivo = a.motivo.trim();
  if (motivo.length < 15 || motivo.length > 255) throw new Error("motivo precisa ter de 15 a 255 caracteres");
  const id = `PRE${a.chaveAcesso}${TIPO_CANCELAMENTO}`;
  const inf =
    el("tpAmb", a.ambiente === "producao" ? "1" : "2") +
    el("verAplic", VER_APLIC) +
    el("dhEvento", dataHoraBrasilia(a.em)) +
    el("CNPJAutor", a.cnpjAutor) +
    el("chNFSe", a.chaveAcesso) +
    grupo("e101101", el("xDesc", "Cancelamento de NFS-e") + el("cMotivo", a.codigoMotivo) + el("xMotivo", motivo));
  return {
    xml: `<pedRegEvento xmlns="${NS_NFSE}" versao="${VERSAO_DPS}"><infPedReg Id="${esc(id)}">${inf}</infPedReg></pedRegEvento>`,
    id,
  };
}
