// Gera src/lib/catalogo/*.json a partir de data/catalogo/*.csv (tabelas oficiais da NFS-e Nacional fornecidas pelo escritório).
import { readFileSync, writeFileSync } from "node:fs";
import Papa from "papaparse";
const ler = (n) => Papa.parse(readFileSync(`data/catalogo/${n}.csv`, "utf8").replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy" }).data;
const servicos = ler("servicos").map((r) => [r.codigo.trim().padStart(6, "0"), r.descricao.trim()]);
const nbs = ler("nbs").map((r) => [r.codigo.trim().padStart(9, "0"), r.descricao.trim()]);
const indop = ler("indop").map((r) => [r.codigo.trim().padStart(6, "0"), r.descricao.trim()]);
const correlacao = ler("correlacao_item_nbs").map((r) => [r.item.trim().padStart(4, "0"), r.nbs.trim().padStart(9, "0"), r.ind_op.trim().padStart(6, "0"), r.cclasstrib.trim().padStart(6, "0")]);
for (const [n, d] of Object.entries({ servicos, nbs, indop, correlacao })) {
  writeFileSync(`src/lib/catalogo/${n}.json`, JSON.stringify(d));
  console.log(n, d.length);
}
