import correlacao from "./correlacao.json";
import indop from "./indop.json";
import nbs from "./nbs.json";
import rtcAtividadeSn from "./rtcAtividadeSn.json";
import rtcCclasstrib from "./rtcCclasstrib.json";
import rtcCorrelacao from "./rtcCorrelacao.json";
import rtcCst from "./rtcCst.json";
import rtcIndop from "./rtcIndop.json";
import servicos from "./servicos.json";

/** Tabelas oficiais da NFS-e Nacional (data/catalogo/*.csv → scripts/gerar-catalogo.mjs → *.json). */
export const catalogo = {
  servicos: servicos as [string, string][],
  nbs: nbs as [string, string][],
  indop: indop as [string, string][],
  correlacao: correlacao as [string, string, string, string][],
  /** IBS/CBS: base oficial da Calculadora da Receita Federal (scripts/extrair-tabelas-rtc.py), só NFS-e. */
  rtcCst: rtcCst as [string, string, boolean][],
  rtcCclasstrib: rtcCclasstrib as [string, string, string, number | null, string][],
  rtcIndop: rtcIndop as [string, string, string, string][],
  rtcCorrelacao: rtcCorrelacao as [string, string, string, string, string][],
  rtcAtividadeSn: rtcAtividadeSn as [string, string, string][],
};

/** Correlação item × NBS vale pelo subitem (4 primeiros dígitos do cTribNac) ou pelo cTribNac inteiro (itens 99). */
export const itensDoCodigo = (codTribNac: string) => [codTribNac.slice(0, 4), codTribNac];
