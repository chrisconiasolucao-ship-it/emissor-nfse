import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { dinheiro, lerValor } from "@/lib/money";
import { COLUNAS, type ChaveColuna } from "./modelo-planilha";

/**
 * Importação de planilha (AT-017, AT-018, AT-031): .xlsx ou .csv no modelo padrão, até 30 linhas.
 * Arquivo acima do limite é recusado inteiro. O SHA-256 do arquivo é a chave de idempotência
 * (documento.sha256 + importacao.documento_id são UNIQUE no banco).
 */
export type LinhaNota = {
  linha: number;
  tomador: {
    tipoDocumento: "CPF" | "CNPJ";
    documento: string;
    nome: string;
    email: string | null;
    endereco: { cep: string; codMunicipio: string; logradouro: string; numero: string; complemento: string | null; bairro: string } | null;
  };
  codigoTributacaoNacional: string;
  codigoNbs: string | null;
  descricao: string;
  valorServico: string;
  competencia: string; // AAAA-MM-01
  issRetido: boolean;
  aliquotaIss: string | null;
};

export type ErroLinha = { linha: number; campo: string; mensagem: string };
export type ResultadoPlanilha = { sha256: string; linhas: LinhaNota[]; erros: ErroLinha[] };

export class PlanilhaGrandeDemais extends Error {
  constructor(public linhas: number, public maximo: number) {
    super(`A planilha tem ${linhas} notas; o limite é ${maximo} por arquivo. Divida em arquivos de até ${maximo} notas e importe cada um.`);
  }
}
export class PlanilhaInvalida extends Error {}

export const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const so = (s: string) => s.replace(/\D/g, "");
/** dígito na posição i (inteiro de 0 a 9; não é valor monetário) */
const dig = (s: string, i: number) => s.charCodeAt(i) - 48;
const int = (s: string | undefined) => Number.parseInt(s ?? "", 10);

export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += dig(cpf, i) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === dig(cpf, 9) && dv(10) === dig(cpf, 10);
}

export function cnpjValido(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((acc, p, i) => acc + dig(cnpj, i) * p, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === dig(cnpj, 12) && dv(13) === dig(cnpj, 13);
}

type Celula = string | number | Date | boolean | null;
type Bruta = Record<ChaveColuna, Celula>;

function texto(v: Celula): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function competenciaDe(v: Celula): string | null {
  if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const s = texto(v);
  let m = s.match(/^(\d{1,2})[/-](\d{4})$/);
  if (m) return int(m[1]) >= 1 && int(m[1]) <= 12 ? `${m[2]}-${m[1]!.padStart(2, "0")}-01` : null;
  m = s.match(/^(\d{4})-(\d{2})(-\d{2})?/);
  if (m) return int(m[2]) >= 1 && int(m[2]) <= 12 ? `${m[1]}-${m[2]}-01` : null;
  return null;
}

async function lerXlsx(arquivo: Buffer): Promise<Celula[][]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(arquivo as unknown as ArrayBuffer);
  } catch {
    throw new PlanilhaInvalida("Não consegui abrir o arquivo como .xlsx.");
  }
  const ws = wb.getWorksheet("notas") ?? wb.worksheets[0];
  if (!ws) throw new PlanilhaInvalida("A planilha não tem abas.");
  const linhas: Celula[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals: Celula[] = [];
    for (let i = 1; i <= COLUNAS.length; i++) {
      const v = row.getCell(i).value as unknown;
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
        vals.push(o.richText ? o.richText.map((r) => r.text).join("") : ((o.text ?? o.result ?? null) as Celula));
      } else vals.push((v ?? null) as Celula);
    }
    linhas.push(vals);
  });
  return linhas;
}

function lerCsv(arquivo: Buffer): Celula[][] {
  const r = Papa.parse<string[]>(arquivo.toString("utf8").replace(/^﻿/, ""), { skipEmptyLines: "greedy", delimiter: "" });
  return r.data;
}

function validarLinha(n: number, b: Bruta, erros: ErroLinha[]): LinhaNota | null {
  const antes = erros.length;
  const erro = (campo: string, mensagem: string) => erros.push({ linha: n, campo, mensagem });

  const tipo = texto(b.tomador_tipo).toUpperCase();
  let doc = so(texto(b.tomador_documento));
  if (tipo === "CPF") {
    doc = doc.padStart(11, "0"); // Excel apaga zero à esquerda de célula numérica
    if (!cpfValido(doc)) erro("tomador_documento", "CPF inválido");
  } else if (tipo === "CNPJ") {
    doc = doc.padStart(14, "0");
    if (!cnpjValido(doc)) erro("tomador_documento", "CNPJ inválido");
  } else erro("tomador_tipo", "use CPF ou CNPJ");

  const nome = texto(b.tomador_nome);
  if (!nome) erro("tomador_nome", "obrigatório");
  const email = texto(b.tomador_email) || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erro("tomador_email", "e-mail inválido");

  const cTribNac = so(texto(b.codigo_tributacao_nacional)).padStart(6, "0");
  if (!/^\d{6}$/.test(cTribNac) || cTribNac === "000000") erro("codigo_tributacao_nacional", "precisa ter 6 dígitos");
  const nbsBruto = so(texto(b.codigo_nbs));
  const nbs = nbsBruto ? nbsBruto.padStart(9, "0") : null;
  if (nbs && !/^\d{9}$/.test(nbs)) erro("codigo_nbs", "precisa ter 9 dígitos");

  const descricao = texto(b.descricao);
  if (!descricao || descricao.length > 2000) erro("descricao", "obrigatória, até 2000 caracteres");

  let valor = "";
  try {
    valor = dinheiro(typeof b.valor === "number" ? b.valor : texto(b.valor));
    if (!lerValor(valor).greaterThan(0)) erro("valor", "precisa ser maior que zero");
  } catch {
    erro("valor", "valor inválido");
  }

  const competencia = competenciaDe(b.competencia);
  if (!competencia) erro("competencia", "use MM/AAAA");

  const retidoTxt = texto(b.iss_retido).toUpperCase();
  const issRetido = retidoTxt === "S" || retidoTxt === "SIM";
  if (retidoTxt && !["S", "SIM", "N", "NAO", "NÃO"].includes(retidoTxt)) erro("iss_retido", "use S ou N");
  let aliquota: string | null = null;
  const aliqTxt = typeof b.aliquota_iss === "number" ? b.aliquota_iss : texto(b.aliquota_iss);
  if (issRetido) {
    try {
      const a = lerValor(aliqTxt === "" ? "x" : aliqTxt);
      if (a.lessThanOrEqualTo(0) || a.greaterThanOrEqualTo(10) || a.decimalPlaces() > 2) throw new Error();
      aliquota = lerValor(aliqTxt).toFixed(2);
    } catch {
      erro("aliquota_iss", "ISS retido exige alíquota maior que 0 e menor que 10, com até 2 casas");
    }
  }

  const cep = so(texto(b.tomador_cep));
  const codMun = so(texto(b.tomador_cod_municipio));
  const logradouro = texto(b.tomador_logradouro);
  const temEndereco = Boolean(cep || codMun || logradouro);
  if (temEndereco) {
    if (!/^\d{8}$/.test(cep)) erro("tomador_cep", "CEP com 8 dígitos");
    if (!/^\d{7}$/.test(codMun)) erro("tomador_cod_municipio", "código IBGE com 7 dígitos");
    if (!logradouro) erro("tomador_logradouro", "obrigatório quando há endereço");
  }

  if (erros.length > antes) return null;
  return {
    linha: n,
    tomador: {
      tipoDocumento: tipo as "CPF" | "CNPJ",
      documento: doc,
      nome,
      email,
      endereco: temEndereco
        ? {
            cep,
            codMunicipio: codMun,
            logradouro,
            numero: texto(b.tomador_numero) || "S/N",
            complemento: texto(b.tomador_complemento) || null,
            bairro: texto(b.tomador_bairro) || "NÃO INFORMADO",
          }
        : null,
    },
    codigoTributacaoNacional: cTribNac,
    codigoNbs: nbs,
    descricao,
    valorServico: valor,
    competencia: competencia!,
    issRetido,
    aliquotaIss: aliquota,
  };
}

export async function lerPlanilha(arquivo: Buffer, nomeArquivo: string, maximo = 30): Promise<ResultadoPlanilha> {
  const ext = nomeArquivo.toLowerCase().split(".").pop();
  let bruto: Celula[][];
  if (ext === "xlsx") bruto = await lerXlsx(arquivo);
  else if (ext === "csv") bruto = lerCsv(arquivo);
  else throw new PlanilhaInvalida("Envie a planilha em .xlsx ou .csv, no modelo padrão.");

  const [cab, ...corpo] = bruto;
  const chaves = (cab ?? []).map((c) => texto(c).toLowerCase());
  const faltando = COLUNAS.filter((c) => c.obrigatoria && !chaves.includes(c.chave)).map((c) => c.chave);
  if (faltando.length > 0) throw new PlanilhaInvalida(`A planilha não está no modelo padrão. Faltam as colunas: ${faltando.join(", ")}.`);

  const linhas = corpo.filter((l) => l.some((v) => texto(v) !== ""));
  if (linhas.length === 0) throw new PlanilhaInvalida("A planilha não tem notas.");
  // AT-017: acima do limite, recusa o arquivo inteiro, antes de validar qualquer linha
  if (linhas.length > maximo) throw new PlanilhaGrandeDemais(linhas.length, maximo);

  const erros: ErroLinha[] = [];
  const validas: LinhaNota[] = [];
  linhas.forEach((l, i) => {
    const b = Object.fromEntries(COLUNAS.map((c) => [c.chave, l[chaves.indexOf(c.chave)] ?? null])) as Bruta;
    const v = validarLinha(i + 2, b, erros); // +2: cabeçalho é a linha 1
    if (v) validas.push(v);
  });
  return { sha256: sha256(arquivo), linhas: validas, erros };
}
