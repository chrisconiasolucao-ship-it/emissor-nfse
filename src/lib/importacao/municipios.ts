import ExcelJS from "exceljs";
import Papa from "papaparse";

/**
 * Situação dos municípios no painel da RFB (Decision 8). O formato exato do arquivo exportado pelo painel
 * não estava disponível no Build: as colunas são achadas pelo nome (sem acento e caixa) e o arquivo
 * é recusado com aviso claro se faltar alguma. Validar com uma exportação real.
 */
export type MunicipioLido = { codIbge: string; nome: string; uf: string; conveniado: boolean; ativoOperacional: boolean; emissorNacional: boolean };

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const sim = (s: unknown) => ["sim", "s", "yes", "true", "1", "ativo", "ativo operacional", "x"].includes(norm(s));

const ALVOS: Record<keyof MunicipioLido, RegExp> = {
  codIbge: /(cod(igo)?[\s_]*ibge|^ibge$|cod[\s_]*municipio)/,
  nome: /^(municipio|nome([\s_]*do)?[\s_]*municipio|nome)$/,
  uf: /^uf$|estado/,
  conveniado: /conveni/,
  ativoOperacional: /ativo|situacao/,
  emissorNacional: /emissor/,
};

export function interpretarLinhas(linhas: unknown[][]): MunicipioLido[] {
  const iCab = linhas.findIndex((l) => l.some((c) => ALVOS.codIbge.test(norm(c))));
  if (iCab < 0) throw new Error("Não achei a coluna do código IBGE. Use a exportação do painel da Receita.");
  const cab = linhas[iCab]!.map(norm);
  const col = Object.fromEntries(Object.entries(ALVOS).map(([k, re]) => [k, cab.findIndex((c) => re.test(c))])) as Record<keyof MunicipioLido, number>;
  const faltam = Object.entries(col).filter(([, i]) => i < 0).map(([k]) => k);
  if (faltam.length > 0) throw new Error(`Faltam colunas no arquivo: ${faltam.join(", ")}.`);
  const saida: MunicipioLido[] = [];
  for (const l of linhas.slice(iCab + 1)) {
    const cod = String(l[col.codIbge] ?? "").replace(/\D/g, "");
    if (!/^\d{7}$/.test(cod)) continue;
    const situacao = norm(l[col.ativoOperacional]);
    saida.push({
      codIbge: cod,
      nome: String(l[col.nome] ?? "").trim(),
      uf: String(l[col.uf] ?? "").trim().toUpperCase().slice(0, 2),
      conveniado: sim(l[col.conveniado]),
      ativoOperacional: situacao.includes("ativo") ? !situacao.includes("inativo") && !situacao.includes("nao") : sim(situacao),
      emissorNacional: sim(l[col.emissorNacional]),
    });
  }
  if (saida.length === 0) throw new Error("Nenhum município com código IBGE válido no arquivo.");
  return saida;
}

export async function lerMunicipios(arquivo: Buffer, nome: string): Promise<MunicipioLido[]> {
  if (nome.toLowerCase().endsWith(".csv")) {
    return interpretarLinhas(Papa.parse<string[]>(arquivo.toString("utf8").replace(/^﻿/, ""), { skipEmptyLines: "greedy" }).data);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arquivo as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Planilha sem abas.");
  const linhas: unknown[][] = [];
  ws.eachRow((r) => linhas.push((r.values as unknown[]).slice(1).map((v) => (v && typeof v === "object" && "text" in v ? (v as { text: string }).text : v))));
  return interpretarLinhas(linhas);
}
