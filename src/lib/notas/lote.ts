/**
 * Download em lote (pedido do José, 27/11/2026): um ZIP com os XMLs das NFS-e prestadas e tomadas de uma
 * empresa num período de competência, para o escritório importar no sistema contábil. Aqui só se monta a
 * lista de arquivos e a planilha de resumo; a rota /api/notas/lote baixa, confere o SHA-256 e compacta.
 *
 * - Prestadas: as emitidas aqui (autorizadas, canceladas e substituídas, com o XML autorizado) mais as
 *   importadas do ADN ou por XML. A que foi emitida aqui e também voltou pelo ADN sai uma vez só (a do sistema).
 * - Tomadas: as importadas do ADN (ou por XML) em que a empresa é a tomadora.
 * - Cancelamento: o XML do evento vai em "eventos", ao lado.
 */
import { semDuplicadas, type Importada } from "./importadas";

export type TipoLote = "prestadas" | "tomadas" | "ambas";

export type Guardado = { id: string; storage_path: string; sha256: string };

export type NotaSistema = {
  id: string;
  empresa_id: string;
  situacao: string;
  numero_nfse: string | null;
  competencia: string | null;
  valor_servico: string | number | null;
  documento_id: string | null;
  danfse_documento_id: string | null;
  tomador: { nome: string | null; documento: string | null } | null;
};

export type ImportadaGuardada = Importada & { storage_path: string; sha256: string };

export type EventoGuardado = Guardado & { nota_id: string | null };

export type ArquivoLote = {
  caminho: string;
  /** arquivo guardado que vai no ZIP; com gerarPdf, é o XML a partir do qual o DANFSe é gerado */
  doc: Guardado;
  gerarPdf?: boolean;
  situacao?: "autorizada" | "cancelada" | "substituida";
};

export type LinhaResumo = {
  tipo: "Prestada" | "Tomada";
  origem: "Emitida no sistema" | "Importada";
  situacao: string;
  numero: string;
  competencia: string;
  documento: string;
  outraParte: string;
  valor: string;
  arquivo: string;
};

/** Teto de notas por ZIP: acima disso, pedir um período menor (a função na Vercel tem 5 min). */
export const LIMITE_XML = 5000;
export const LIMITE_COM_PDF = 1500;

export const SITUACOES_COM_XML = ["autorizada", "cancelada", "substituida"] as const;

const ROTULO: Record<string, string> = { autorizada: "Autorizada", cancelada: "Cancelada", substituida: "Substituída", importada: "Importada" };

/** Tipo pedido na tela/URL; qualquer outra coisa vale "ambas". */
export function tipoLote(v: string | null | undefined): TipoLote {
  return v === "prestadas" || v === "tomadas" ? v : "ambas";
}

const limpo = (s: string | null | undefined) => String(s ?? "").replace(/[^0-9A-Za-z]/g, "");
const mesAno = (c: string | null) => (c ? `${c.slice(5, 7)}/${c.slice(0, 4)}` : "");
const valorBr = (v: string | number | null) => (v == null || v === "" ? "" : Number(v).toFixed(2).replace(".", ","));

function nomeBase(numero: string | null, doc: string | null | undefined, id: string): string {
  const n = limpo(numero) || id.slice(0, 8);
  const d = limpo(doc);
  return d ? `NFSe-${n}-${d}` : `NFSe-${n}`;
}

export function montarLote(e: {
  tipo: TipoLote;
  pdf: boolean;
  notas: NotaSistema[];
  docsDasNotas: Guardado[];
  eventos: EventoGuardado[];
  importadas: ImportadaGuardada[];
  numerosDoSistema: { empresa_id: string; numero_nfse: string | null }[];
}): { arquivos: ArquivoLote[]; resumo: LinhaResumo[] } {
  const arquivos: ArquivoLote[] = [];
  const resumo: LinhaResumo[] = [];
  const porId = new Map(e.docsDasNotas.map((d) => [d.id, d]));
  const querPrestadas = e.tipo !== "tomadas";
  const querTomadas = e.tipo !== "prestadas";
  // mesmo número e mesma outra parte (ex.: prestada importada de outro prestador) não pode sobrescrever
  const usados = new Set<string>();
  const livre = (pasta: string, base: string) => {
    let b = base;
    for (let i = 2; usados.has(`${pasta}/${b}`.toLowerCase()); i++) b = `${base}-${i}`;
    usados.add(`${pasta}/${b}`.toLowerCase());
    return b;
  };

  if (querPrestadas) {
    for (const n of e.notas) {
      const sit = n.situacao as ArquivoLote["situacao"];
      if (!SITUACOES_COM_XML.includes(sit as never)) continue;
      const xml = n.documento_id ? porId.get(n.documento_id) : undefined;
      if (!xml) continue;
      const base = livre("prestadas", nomeBase(n.numero_nfse, n.tomador?.documento, n.id));
      arquivos.push({ caminho: `prestadas/${base}.xml`, doc: xml });
      if (e.pdf) {
        const danfse = n.danfse_documento_id ? porId.get(n.danfse_documento_id) : undefined;
        // o DANFSe guardado é o da autorização; cancelada/substituída sai gerada de novo com a tarja
        arquivos.push(danfse && sit === "autorizada"
          ? { caminho: `prestadas/PDF/${base}.pdf`, doc: danfse }
          : { caminho: `prestadas/PDF/${base}.pdf`, doc: xml, gerarPdf: true, situacao: sit });
      }
      e.eventos.filter((ev) => ev.nota_id === n.id).forEach((ev, i) => {
        arquivos.push({ caminho: `prestadas/eventos/${base}-evento${i ? `-${i + 1}` : ""}.xml`, doc: ev });
      });
      resumo.push({
        tipo: "Prestada", origem: "Emitida no sistema", situacao: ROTULO[n.situacao] ?? n.situacao, numero: n.numero_nfse ?? "",
        competencia: mesAno(n.competencia), documento: n.tomador?.documento ?? "", outraParte: n.tomador?.nome ?? "",
        valor: valorBr(n.valor_servico), arquivo: `prestadas/${base}.xml`,
      });
    }
  }

  // só a prestada pode ser repetida de uma emitida aqui; a tomada tem outro prestador (o número pode coincidir)
  const importadas = [
    ...semDuplicadas(e.importadas.filter((d) => d.papel === "prestada"), e.numerosDoSistema),
    ...e.importadas.filter((d) => d.papel === "tomada"),
  ];
  for (const d of importadas) {
    const prestada = d.papel === "prestada";
    if (prestada ? !querPrestadas : !querTomadas) continue;
    const pasta = prestada ? "prestadas" : "tomadas";
    const base = livre(pasta, nomeBase(d.numero_nfse, d.outra_parte_documento, d.id));
    const doc: Guardado = { id: d.id, storage_path: d.storage_path, sha256: d.sha256 };
    arquivos.push({ caminho: `${pasta}/${base}.xml`, doc });
    if (e.pdf) arquivos.push({ caminho: `${pasta}/PDF/${base}.pdf`, doc, gerarPdf: true });
    resumo.push({
      tipo: prestada ? "Prestada" : "Tomada", origem: "Importada", situacao: "Importada", numero: d.numero_nfse ?? "",
      competencia: mesAno(d.competencia), documento: d.outra_parte_documento ?? "", outraParte: d.outra_parte ?? d.nome_original ?? "",
      valor: valorBr(d.valor), arquivo: `${pasta}/${base}.xml`,
    });
  }
  return { arquivos, resumo };
}

/** Planilha de conferência (CSV com ";" e vírgula decimal, abre direto no Excel em português). */
export function resumoCsv(linhas: LinhaResumo[]): string {
  const cel = (s: string) => (/[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const cab = ["Tipo", "Origem", "Situação", "Número NFS-e", "Competência", "CPF/CNPJ da outra parte", "Outra parte", "Valor", "Arquivo"];
  const corpo = linhas.map((l) => [l.tipo, l.origem, l.situacao, l.numero, l.competencia, l.documento, l.outraParte, l.valor, l.arquivo].map(cel).join(";"));
  return `﻿${[cab.join(";"), ...corpo].join("\r\n")}\r\n`;
}

/** Nome do ZIP: CNPJ + período, ex. "NFSe-12345678000199-2026-10-a-2026-11-ambas.zip". */
export function nomeDoZip(cnpj: string, de?: string, ate?: string, tipo: TipoLote = "ambas"): string {
  const p = de && ate ? (de === ate ? de : `${de}-a-${ate}`) : de ? `desde-${de}` : ate ? `ate-${ate}` : "todos-os-meses";
  return `NFSe-${limpo(cnpj)}-${p}-${tipo}.zip`;
}
