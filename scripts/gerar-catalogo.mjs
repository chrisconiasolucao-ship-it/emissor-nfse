// Gera src/lib/catalogo/*.json a partir de data/catalogo/*.csv (tabelas oficiais da NFS-e Nacional fornecidas pelo escritório).
import { readFileSync, writeFileSync } from "node:fs";
import Papa from "papaparse";
const ler = (n) => Papa.parse(readFileSync(`data/catalogo/${n}.csv`, "utf8").replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy" }).data;
const servicos = ler("servicos").map((r) => [r.codigo.trim().padStart(6, "0"), r.descricao.trim()]);
const nbs = ler("nbs").map((r) => [r.codigo.trim().padStart(9, "0"), r.descricao.trim()]);
const indop = ler("indop").map((r) => [r.codigo.trim().padStart(6, "0"), r.descricao.trim()]);
const correlacao = ler("correlacao_item_nbs").map((r) => [r.item.trim().padStart(4, "0"), r.nbs.trim().padStart(9, "0"), r.ind_op.trim().padStart(6, "0"), r.cclasstrib.trim().padStart(6, "0")]);
// IBS/CBS (base da Calculadora da Receita Federal, extraída por scripts/extrair-tabelas-rtc.py)
const rtcCst = ler("rtc_cst").map((r) => [r.codigo, r.descricao, r.exige_gibscbs === "1"]);
const rtcCclasstrib = ler("rtc_cclasstrib").map((r) => [r.codigo, r.cst, r.nome, r.tp_rbsn === "" ? null : Number(r.tp_rbsn), r.inicio_vigencia]);
const rtcIndop = ler("rtc_indop").map((r) => [r.codigo, r.local_incidencia, r.tipo_operacao, r.inicio_vigencia]);
const rtcCorrelacao = ler("rtc_correlacao").map((r) => [r.item, r.nbs, r.ind_op, r.cclasstrib, r.inicio_vigencia]);
const rtcAtividadeSn = ler("rtc_atividade_sn").map((r) => [r.codigo, r.anexo, r.descricao]);
for (const [n, d] of Object.entries({ servicos, nbs, indop, correlacao, rtcCst, rtcCclasstrib, rtcIndop, rtcCorrelacao, rtcAtividadeSn })) {
  writeFileSync(`src/lib/catalogo/${n}.json`, JSON.stringify(d));
  console.log(n, d.length);
}
