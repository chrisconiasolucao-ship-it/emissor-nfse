import { iss, lerValor, somar } from "@/lib/money";

/**
 * Contas dos relatórios, sem banco: recebem as linhas já lidas e devolvem os agrupamentos.
 * Só nota AUTORIZADA entra em faturamento e ISS: cancelada não vale e substituída foi trocada por outra
 * nota autorizada (que já está na soma).
 */

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Limite anual de receita bruta (LC 123/2006): MEI R$ 81 mil, ME R$ 360 mil, EPP R$ 4,8 milhões. */
export const LIMITE_ANUAL: Record<string, string> = { MEI: "81000.00", ME: "360000.00", EPP: "4800000.00" };
/** A partir de quanto do limite o relatório avisa. */
export const AVISO_LIMITE = 0.8;

export const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2026-11" → "11/2026"; aceita também "2026-11-01". */
export function mesAno(c: string | null | undefined): string {
  if (!c) return "—";
  return `${c.slice(5, 7)}/${c.slice(0, 4)}`;
}
export const mesCurto = (c: string) => MESES[Number(c.slice(5, 7)) - 1]!;
export const mesLongo = (c: string) => MESES_LONGOS[Number(c.slice(5, 7)) - 1]!;

/** Soma n meses a uma competência "AAAA-MM" (n pode ser negativo). */
export function somarMeses(c: string, n: number): string {
  const [a, m] = c.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Competências de "de" até "ate", inclusive. Intervalo invertido é trocado; no máximo 60 meses. */
export function intervalo(de: string, ate: string): string[] {
  const [ini, fim] = de <= ate ? [de, ate] : [ate, de];
  const out: string[] = [];
  for (let c = ini; c <= fim && out.length < 60; c = somarMeses(c, 1)) out.push(c);
  return out;
}

/** Período em texto: "11/2026" ou "01/2026 a 11/2026". */
export function periodo(de: string, ate: string): string {
  const [ini, fim] = de <= ate ? [de, ate] : [ate, de];
  return ini === fim ? mesAno(ini) : `${mesAno(ini)} a ${mesAno(fim)}`;
}

export type NotaValor = { competencia: string | null; valor_servico: string | number | null; iss_retido?: boolean | null; aliquota_iss?: string | number | null };

/** ISS retido de uma nota (base = valor do serviço; sem retenção, o ISS vai no DAS e não aparece aqui). */
export function issRetido(n: NotaValor): string | null {
  if (!n.iss_retido || n.aliquota_iss == null || n.valor_servico == null) return null;
  return iss(String(n.valor_servico), String(n.aliquota_iss));
}

const soma = (vs: string[]) => (vs.length ? somar(...vs) : "0.00");

export type LinhaMes = { competencia: string; notas: number; valor: string; issRetido: string; acumuladoAno: string; rbt12: string };

/**
 * Faturamento do ano, mês a mês. `notas` deve trazer as autorizadas do ano e dos 12 meses anteriores, para o
 * RBT12 de cada mês (receita bruta dos 12 meses anteriores ao período de apuração, como no PGDAS-D).
 */
export function faturamentoMensal(notas: NotaValor[], ano: string): LinhaMes[] {
  const porMes = new Map<string, { valores: string[]; iss: string[] }>();
  for (const n of notas) {
    if (!n.competencia || n.valor_servico == null) continue;
    const c = n.competencia.slice(0, 7);
    const m = porMes.get(c) ?? { valores: [], iss: [] };
    m.valores.push(String(n.valor_servico));
    const r = issRetido(n);
    if (r) m.iss.push(r);
    porMes.set(c, m);
  }
  const doMes = (c: string) => soma(porMes.get(c)?.valores ?? []);
  const linhas: LinhaMes[] = [];
  let acumulado = "0.00";
  for (let i = 1; i <= 12; i++) {
    const c = `${ano}-${String(i).padStart(2, "0")}`;
    const valor = doMes(c);
    acumulado = somar(acumulado, valor);
    const anteriores = Array.from({ length: 12 }, (_, k) => doMes(somarMeses(c, -(k + 1))));
    linhas.push({ competencia: c, notas: porMes.get(c)?.valores.length ?? 0, valor, issRetido: soma(porMes.get(c)?.iss ?? []), acumuladoAno: acumulado, rbt12: soma(anteriores) });
  }
  return linhas;
}

/** Quanto do limite anual do regime já foi usado, em % com uma casa (null se o regime não tem limite conhecido). */
export function percentualLimite(acumuladoAno: string, regime: string | null | undefined): number | null {
  const limite = regime ? LIMITE_ANUAL[regime] : undefined;
  if (!limite) return null;
  return Number(lerValor(acumuladoAno).div(lerValor(limite)).mul(100).toDecimalPlaces(1).toString());
}

export type LinhaMunicipio = { codigo: string; notas: number; receita: string; semRetencao: string; comRetencao: string; issRetido: string; aliquotas: string[] };

/** ISS por município de prestação: receita com ISS no DAS (sem retenção) e com ISS retido pelo tomador. */
export function issPorMunicipio(notas: (NotaValor & { cod_municipio_prestacao: string | null })[]): LinhaMunicipio[] {
  const grupos = new Map<string, { notas: number; receita: string[]; sem: string[]; com: string[]; iss: string[]; aliq: Set<string> }>();
  for (const n of notas) {
    if (n.valor_servico == null) continue;
    const cod = n.cod_municipio_prestacao ?? "";
    const g = grupos.get(cod) ?? { notas: 0, receita: [], sem: [], com: [], iss: [], aliq: new Set<string>() };
    const v = String(n.valor_servico);
    g.notas++;
    g.receita.push(v);
    const r = issRetido(n);
    if (r) {
      g.com.push(v);
      g.iss.push(r);
      g.aliq.add(lerValor(String(n.aliquota_iss)).toFixed(2));
    } else g.sem.push(v);
    grupos.set(cod, g);
  }
  return [...grupos.entries()]
    .map(([codigo, g]) => ({ codigo, notas: g.notas, receita: soma(g.receita), semRetencao: soma(g.sem), comRetencao: soma(g.com), issRetido: soma(g.iss), aliquotas: [...g.aliq].sort() }))
    .sort((a, b) => lerValor(b.receita).comparedTo(lerValor(a.receita)));
}

/** Soma de uma coluna de valores (ignora vazios). */
export function total(valores: (string | number | null | undefined)[]): string {
  return soma(valores.filter((v): v is string | number => v != null && v !== "").map(String));
}

/** Data/hora no fuso de Brasília: "27/11/2026" ou "27/11/2026 10:14". */
export function dataBR(iso: string | null | undefined, comHora = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", ...(comHora ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(d).replace(",", "");
}
