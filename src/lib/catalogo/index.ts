import correlacao from "./correlacao.json";
import indop from "./indop.json";
import nbs from "./nbs.json";
import servicos from "./servicos.json";

/** Tabelas oficiais da NFS-e Nacional (data/catalogo/*.csv → scripts/gerar-catalogo.mjs → *.json). */
export const catalogo = {
  servicos: servicos as [string, string][],
  nbs: nbs as [string, string][],
  indop: indop as [string, string][],
  correlacao: correlacao as [string, string, string, string][],
};

/** Correlação item × NBS vale pelo subitem (4 primeiros dígitos do cTribNac) ou pelo cTribNac inteiro (itens 99). */
export const itensDoCodigo = (codTribNac: string) => [codTribNac.slice(0, 4), codTribNac];
