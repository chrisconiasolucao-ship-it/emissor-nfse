import ExcelJS from "exceljs";
import Papa from "papaparse";

/**
 * Situação dos municípios (Decision 8). Dois formatos aceitos, com colunas achadas pelo nome (sem acento e caixa):
 *  1. Planilha "municipios-aderentes-AAAAMMDD" da página Monitoramento das adesões (gov.br/nfse): CSV em
 *     Latin-1 com ";" ou XLSX, SEM código IBGE (Regiao;UF;NomeMunicipio;CNPJ;StatusConvenioSEFIN;…;
 *     AderenteEmissorNacional;…;Situação;…). O código IBGE vem da lista oficial do IBGE, casada por UF + nome.
 *  2. Arquivo com coluna de código IBGE e colunas conveniado / situação / emissor.
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

export type ResultadoMunicipios = { lidos: MunicipioLido[]; semCodigo: string[] };
/** UF|nome-sem-acento-espaço-e-pontuação → código IBGE */
export type MapaIbge = Map<string, string>;

export const chaveMunicipio = (uf: string, nome: string) =>
  `${uf.trim().toUpperCase()}|${String(nome).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "")}`;

/** Nomes antigos que a planilha da Receita ainda usa (conferidos contra o IBGE em 26/11/2026). */
const ALIAS_RFB: Record<string, string> = {
  "GO|BOMJESUS": "5203500", // Bom Jesus de Goiás
  "BA|LAGEDODOTABOCAL": "2919058", // Lajedo do Tabocal
  "RN|BOASAUDE": "2405306", // Januário Cicco
  "TO|SAOVALERIODANATIVIDADE": "1720499", // São Valério
  "PR|MUNHOZDEMELLO": "4116307", // Munhoz de Melo
};

/** Lista oficial do IBGE (API de localidades), só quando o arquivo não traz o código. */
export async function buscarIbgeOficial(): Promise<MapaIbge> {
  const r = await fetch("https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado", { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`A lista de municípios do IBGE não respondeu (HTTP ${r.status}). Tente de novo em alguns minutos.`);
  const dados = (await r.json()) as { "municipio-id": number; "municipio-nome": string; "UF-sigla": string }[];
  return new Map(dados.map((m) => [chaveMunicipio(m["UF-sigla"], m["municipio-nome"]), String(m["municipio-id"])]));
}

function cabecalhoRfb(linhas: unknown[][]) {
  const i = linhas.findIndex((l) => { const c = l.map(norm); return c.includes("nomemunicipio") && c.includes("uf"); });
  if (i < 0) return null;
  const c = linhas[i]!.map(norm);
  const col = { uf: c.indexOf("uf"), nome: c.indexOf("nomemunicipio"), convenio: c.findIndex((x) => x.startsWith("statusconvenio")),
    emissor: c.indexOf("aderenteemissornacional"), situacao: c.indexOf("situacao") };
  const faltam = Object.entries(col).filter(([, j]) => j < 0).map(([k]) => k);
  if (faltam.length > 0) throw new Error(`Faltam colunas na planilha da Receita: ${faltam.join(", ")}.`);
  return { i, col };
}

export function precisaIbge(linhas: unknown[][]): boolean {
  return !linhas.some((l) => l.some((c) => ALVOS.codIbge.test(norm(c)))) && cabecalhoRfb(linhas) !== null;
}

export function interpretarLinhas(linhas: unknown[][], ibge?: MapaIbge): ResultadoMunicipios {
  const iCab = linhas.findIndex((l) => l.some((c) => ALVOS.codIbge.test(norm(c))));
  if (iCab < 0) {
    const rfb = cabecalhoRfb(linhas);
    if (!rfb) throw new Error("Formato não reconhecido. Use a planilha \"municípios aderentes\" da página Monitoramento das adesões (gov.br/nfse).");
    if (!ibge) throw new Error("A planilha da Receita não traz o código IBGE e a lista do IBGE não foi carregada.");
    const { col } = rfb;
    const lidos: MunicipioLido[] = []; const semCodigo: string[] = [];
    for (const l of linhas.slice(rfb.i + 1)) {
      const uf = String(l[col.uf] ?? "").trim().toUpperCase(); const nome = String(l[col.nome] ?? "").trim();
      if (!/^[A-Z]{2}$/.test(uf) || !nome) continue;
      const chave = chaveMunicipio(uf, nome);
      const cod = ibge.get(chave) ?? ALIAS_RFB[chave];
      if (!cod) { semCodigo.push(`${nome}/${uf}`); continue; }
      lidos.push({ codIbge: cod, nome, uf, conveniado: norm(l[col.convenio]).startsWith("conveniado"),
        ativoOperacional: norm(l[col.situacao]) === "ativo", emissorNacional: sim(l[col.emissor]) });
    }
    if (lidos.length === 0) throw new Error("Nenhum município da planilha foi encontrado na lista do IBGE.");
    return { lidos, semCodigo };
  }
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
  return { lidos: saida, semCodigo: [] };
}

/** CSV da Receita vem em Latin-1; aceita também UTF-8. */
function textoCsv(arquivo: Buffer): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(arquivo).replace(/^\uFEFF/, ""); }
  catch { return new TextDecoder("latin1").decode(arquivo); }
}

export async function lerMunicipios(arquivo: Buffer, nome: string, buscarIbge: () => Promise<MapaIbge> = buscarIbgeOficial): Promise<ResultadoMunicipios> {
  const comIbge = async (linhas: unknown[][]) => interpretarLinhas(linhas, precisaIbge(linhas) ? await buscarIbge() : undefined);
  if (nome.toLowerCase().endsWith(".csv")) {
    return comIbge(Papa.parse<string[]>(textoCsv(arquivo), { skipEmptyLines: "greedy" }).data);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arquivo as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Planilha sem abas.");
  const linhas: unknown[][] = [];
  ws.eachRow((r) => linhas.push((r.values as unknown[]).slice(1).map((v) => (v && typeof v === "object" && "text" in v ? (v as { text: string }).text : v))));
  return comIbge(linhas);
}
