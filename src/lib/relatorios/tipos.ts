/**
 * Modelo único de relatório: a tela, o PDF e o Excel leem a mesma estrutura, então os três mostram
 * exatamente os mesmos números. Valores em dinheiro andam como string decimal ("1234.56", ver money.ts).
 */
export type TipoColuna = "texto" | "valor" | "inteiro" | "selo";

export type Coluna = { rotulo: string; tipo?: TipoColuna; /** peso da largura no PDF (padrão 1) */ largura?: number };

/** Selo de estado: classe CSS da tela (autorizada, rejeitada, alerta...) e o texto. */
export type Selo = { selo: string; texto: string };
/** Texto com link (só na tela; PDF e Excel usam o texto). */
export type Link = { texto: string; href: string };
export type Celula = string | number | null | Selo | Link | Selo[];

export type Destaque = { rotulo: string; valor: string; sub?: string };
export type Barra = { rotulo: string; valor: string };

export type Relatorio = {
  titulo: string;
  /** empresa(s) e período, vai no cabeçalho da tela, do PDF e do Excel */
  subtitulo: string;
  colunas: Coluna[];
  linhas: Celula[][];
  total?: Celula[];
  destaques?: Destaque[];
  grafico?: Barra[];
  observacoes?: string[];
  vazio: string;
};

export type ChaveRelatorio = "notas" | "faturamento" | "iss" | "tomadas" | "ocorrencias" | "carteira";

export const RELATORIOS: { chave: ChaveRelatorio; titulo: string; descricao: string; soEscritorio?: boolean }[] = [
  { chave: "notas", titulo: "Notas emitidas", descricao: "Todas as NFS-e da empresa no período, com tomador, serviço, valor e situação, e o total das autorizadas." },
  { chave: "faturamento", titulo: "Faturamento mensal", descricao: "Soma das notas autorizadas mês a mês, acumulado do ano e dos 12 meses anteriores (RBT12) e o limite do Simples." },
  { chave: "iss", titulo: "ISS e retenções", descricao: "Receita por município de prestação, separando a receita com ISS no DAS da receita com ISS retido pelo tomador." },
  { chave: "tomadas", titulo: "Notas tomadas (ADN)", descricao: "NFS-e em que a empresa contratou o serviço, baixadas do Ambiente de Dados Nacional." },
  { chave: "ocorrencias", titulo: "Canceladas, substituídas e rejeitadas", descricao: "O que saiu do caminho normal no período, com motivo, quem fez e quando." },
  { chave: "carteira", titulo: "Resumo da carteira", descricao: "Uma linha por empresa: notas e faturamento do mês, RBT12, pendências e vencimento do certificado.", soEscritorio: true },
];

export const eChave = (s: string): s is ChaveRelatorio => RELATORIOS.some((r) => r.chave === s);

/** Filtros vindos da URL (todos opcionais; competências no formato AAAA-MM). */
export type Filtros = {
  empresa?: string;
  de?: string;
  ate?: string;
  situacao?: string;
  tomador?: string;
  servico?: string;
  ano?: string;
  tipo?: string;
  regime?: string;
  competencia?: string;
};

export const CAMPOS_FILTRO: (keyof Filtros)[] = ["empresa", "de", "ate", "situacao", "tomador", "servico", "ano", "tipo", "regime", "competencia"];

/** Texto puro de uma célula (PDF, Excel e ordenação). */
export function textoCelula(c: Celula): string {
  if (c == null) return "";
  if (Array.isArray(c)) return c.map((s) => s.texto).join(" · ");
  if (typeof c === "object") return c.texto;
  return String(c);
}
