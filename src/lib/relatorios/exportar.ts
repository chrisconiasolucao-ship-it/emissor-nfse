import ExcelJS from "exceljs";
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from "pdf-lib";
import { lerValor } from "@/lib/money";
import { textoCelula, type Celula, type Coluna, type Relatorio } from "./tipos";

/** Quem gerou e quando: vai no cabeçalho do PDF e do Excel. */
export type Rodape = { geradoEm: string; geradoPor: string; ambiente: string };

const numero = (c: Celula): number | null => {
  if (c == null || typeof c === "object") return null;
  const s = String(c);
  if (s === "" || s === "—") return null;
  try {
    return Number(lerValor(s).toString());
  } catch {
    return null;
  }
};

/** Valor para a tela e o PDF: "1234.5" → "1.234,50". */
export function valorBR(c: Celula): string {
  const s = textoCelula(c);
  if (s === "") return "—";
  try {
    const [int, dec] = lerValor(s).toFixed(2).split(".");
    return `${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
  } catch {
    return s;
  }
}

export function textoExibido(c: Celula, col: Coluna): string {
  if (col.tipo === "valor") return valorBR(c);
  const s = textoCelula(c);
  return s === "" ? "—" : s;
}

/* ---------------------------------------------------------------- Excel */

export async function relatorioXlsx(r: Relatorio, rodape: Rodape): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CHRISCON · NFS-e";
  wb.created = new Date();
  const ws = wb.addWorksheet(r.titulo.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  const n = r.colunas.length;
  ws.addRow([r.titulo]).font = { bold: true, size: 14 };
  ws.addRow([r.subtitulo]);
  ws.addRow([`Gerado em ${rodape.geradoEm} por ${rodape.geradoPor} · ${rodape.ambiente}`]).font = { color: { argb: "FF5F6B7A" }, size: 9 };
  for (const d of r.destaques ?? []) ws.addRow([d.rotulo, d.valor, d.sub ?? ""]);
  ws.addRow([]);
  const cab = ws.addRow(r.colunas.map((c) => c.rotulo));
  cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cab.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E252C" } }; });
  const linhaCab = cab.number;

  const celula = (c: Celula, col: Coluna): string | number | null => {
    if (col.tipo === "valor" || col.tipo === "inteiro") return numero(c);
    const s = textoCelula(c);
    return s === "" ? null : s;
  };
  for (const l of r.linhas) ws.addRow(l.map((c, i) => celula(c, r.colunas[i]!)));
  if (r.total) {
    const t = ws.addRow(r.total.map((c, i) => celula(c, r.colunas[i]!)));
    t.font = { bold: true };
    t.eachCell((cell) => { cell.border = { top: { style: "thin" } }; });
  }
  for (const o of r.observacoes ?? []) ws.addRow([o]).font = { italic: true, color: { argb: "FF5F6B7A" }, size: 9 };

  r.colunas.forEach((col, i) => {
    const coluna = ws.getColumn(i + 1);
    if (col.tipo === "valor") coluna.numFmt = "#,##0.00";
    if (col.tipo === "inteiro") coluna.numFmt = "0";
    const maior = Math.max(col.rotulo.length, ...r.linhas.map((l) => textoExibido(l[i] ?? null, col).length));
    coluna.width = Math.min(Math.max(maior + 2, 10), 60);
  });
  ws.views = [{ state: "frozen", ySplit: linhaCab }];
  if (r.linhas.length) ws.autoFilter = { from: { row: linhaCab, column: 1 }, to: { row: linhaCab + r.linhas.length, column: n } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ---------------------------------------------------------------- PDF */

const GRAFITE = rgb(0x1e / 255, 0x25 / 255, 0x2c / 255);
const AZUL = rgb(0x15 / 255, 0x65 / 255, 0xd8 / 255);
const SUAVE = rgb(0x5f / 255, 0x6b / 255, 0x7a / 255);
const BORDA = rgb(0xdd / 255, 0xe2 / 255, 0xe9 / 255);
const FUNDO = rgb(0xf2 / 255, 0xf4 / 255, 0xf7 / 255);
const TEXTO = rgb(0x1c / 255, 0x23 / 255, 0x2c / 255);

/** A fonte padrão do PDF só tem o alfabeto WinAnsi: troca o que não existe nela (setas, aspas tipográficas...). */
export function seguro(font: PDFFont, s: string): string {
  const trocado = s.replace(/→/g, "->").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ");
  try {
    font.encodeText(trocado);
    return trocado;
  } catch {
    return [...trocado].map((ch) => { try { font.encodeText(ch); return ch; } catch { return "?"; } }).join("");
  }
}

function cortar(font: PDFFont, s: string, tamanho: number, largura: number): string {
  if (font.widthOfTextAtSize(s, tamanho) <= largura) return s;
  let t = s;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, tamanho) > largura) t = t.slice(0, -1);
  return `${t}…`;
}

export async function relatorioPdf(r: Relatorio, rodape: Rodape): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${r.titulo} · ${r.subtitulo}`);
  pdf.setCreator("CHRISCON · NFS-e");
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  // Tabela larga sai em paisagem.
  const paisagem = r.colunas.length > 6;
  const [W, H] = paisagem ? [841.89, 595.28] : [595.28, 841.89];
  const M = 32;
  const util = W - 2 * M;
  const T = 8;
  const ALT = 15;

  // larguras: peso da coluna × conteúdo, limitado ao espaço útil
  const pesos = r.colunas.map((col, i) => {
    const textos = [col.rotulo, ...r.linhas.slice(0, 200).map((l) => textoExibido(l[i] ?? null, col)), ...(r.total ? [textoExibido(r.total[i] ?? null, col)] : [])];
    const maior = Math.max(negrito.widthOfTextAtSize(seguro(negrito, col.rotulo), T), ...textos.map((t) => normal.widthOfTextAtSize(seguro(normal, t), T)));
    return Math.min(maior + 10, 220) * (col.largura ?? 1);
  });
  const somaPesos = pesos.reduce((a, b) => a + b, 0);
  const larguras = pesos.map((p) => (p / somaPesos) * util);

  const paginas: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const escrever = (p: PDFPage, s: string, x: number, yy: number, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; largura?: number; direita?: boolean } = {}) => {
    const font = o.font ?? normal;
    const size = o.size ?? T;
    let t = seguro(font, s);
    if (o.largura) t = cortar(font, t, size, o.largura);
    const w = font.widthOfTextAtSize(t, size);
    p.drawText(t, { x: o.direita && o.largura ? x + o.largura - w : x, y: yy, size, font, color: o.color ?? TEXTO });
  };

  const cabecalhoTabela = () => {
    page.drawRectangle({ x: M, y: y - 4, width: util, height: ALT, color: GRAFITE });
    let x = M;
    r.colunas.forEach((col, i) => {
      const direita = col.tipo === "valor" || col.tipo === "inteiro";
      escrever(page, col.rotulo, x + 3, y, { font: negrito, color: rgb(1, 1, 1), largura: larguras[i]! - 6, direita });
      x += larguras[i]!;
    });
    y -= ALT;
  };

  const novaPagina = (primeira: boolean) => {
    page = pdf.addPage([W, H]);
    paginas.push(page);
    y = H - M;
    page.drawRectangle({ x: M, y: y - 4, width: 4, height: 20, color: AZUL });
    escrever(page, "CHRISCON · NFS-e", M + 10, y + 6, { font: negrito, size: 11, color: GRAFITE });
    escrever(page, r.titulo, M + 10, y - 6, { size: 9, color: SUAVE });
    const dir = [r.subtitulo, `Gerado em ${rodape.geradoEm} por ${rodape.geradoPor}`];
    dir.forEach((t, k) => escrever(page, t, W / 2, y + 6 - k * 11, { size: 8, color: k ? SUAVE : TEXTO, largura: W / 2 - M, direita: true }));
    y -= 18;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: GRAFITE });
    y -= 18;
    if (primeira) {
      escrever(page, r.titulo, M, y, { font: negrito, size: 15, color: GRAFITE });
      y -= 16;
      escrever(page, r.subtitulo, M, y, { size: 9.5, color: SUAVE });
      y -= 20;
      if (r.destaques?.length) {
        const lg = (util - 10 * (r.destaques.length - 1)) / r.destaques.length;
        r.destaques.forEach((d, k) => {
          const x = M + k * (lg + 10);
          page.drawRectangle({ x, y: y - 26, width: lg, height: 38, color: FUNDO, borderColor: BORDA, borderWidth: 0.6 });
          escrever(page, d.rotulo, x + 8, y, { size: 7.5, color: SUAVE, largura: lg - 16 });
          escrever(page, d.valor, x + 8, y - 15, { font: negrito, size: 11, largura: lg - 16 });
          if (d.sub) escrever(page, d.sub, x + 8, y - 24, { size: 6.5, color: SUAVE, largura: lg - 16 });
        });
        y -= 48;
      }
      if (r.grafico?.length) y = grafico(page, r.grafico, M, y, util) - 12;
    }
    cabecalhoTabela();
  };

  const grafico = (p: PDFPage, barras: NonNullable<Relatorio["grafico"]>, x0: number, topo: number, largura: number): number => {
    const alt = 90;
    const valores = barras.map((b) => Number(b.valor) || 0);
    const maior = Math.max(...valores, 0);
    const passo = largura / barras.length;
    const base = topo - alt;
    p.drawLine({ start: { x: x0, y: base }, end: { x: x0 + largura, y: base }, thickness: 0.6, color: BORDA });
    barras.forEach((b, k) => {
      const h = maior ? (valores[k]! / maior) * (alt - 14) : 0;
      const x = x0 + k * passo + passo * 0.18;
      if (h > 0) p.drawRectangle({ x, y: base, width: passo * 0.64, height: h, color: AZUL });
      escrever(p, b.rotulo, x0 + k * passo, base - 10, { size: 7, color: SUAVE, largura: passo, direita: false });
      if (valores[k]) escrever(p, valorBR(b.valor).replace(/,\d\d$/, ""), x0 + k * passo, base + h + 3, { size: 6.5, color: SUAVE, largura: passo });
    });
    return base - 14;
  };

  const linha = (cells: Celula[], o: { negrito?: boolean; fundo?: boolean } = {}) => {
    if (y < M + 30) novaPagina(false);
    if (o.fundo) page.drawRectangle({ x: M, y: y - 4, width: util, height: ALT, color: FUNDO });
    let x = M;
    r.colunas.forEach((col, i) => {
      const direita = col.tipo === "valor" || col.tipo === "inteiro";
      const c = cells[i] ?? null;
      escrever(page, o.negrito && c == null ? "" : textoExibido(c, col), x + 3, y, { font: o.negrito ? negrito : normal, largura: larguras[i]! - 6, direita });
      x += larguras[i]!;
    });
    page.drawLine({ start: { x: M, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: o.negrito ? 1 : 0.4, color: o.negrito ? GRAFITE : BORDA });
    y -= ALT;
  };

  novaPagina(true);
  if (!r.linhas.length) {
    escrever(page, r.vazio, M + 3, y, { color: SUAVE });
    y -= ALT;
  }
  r.linhas.forEach((l, k) => linha(l, { fundo: k % 2 === 1 }));
  if (r.total) linha(r.total, { negrito: true });
  for (const o of r.observacoes ?? []) {
    if (y < M + 30) novaPagina(false);
    y -= 4;
    escrever(page, o, M, y, { size: 7.5, color: SUAVE, largura: util });
    y -= 11;
  }

  paginas.forEach((p, k) => {
    escrever(p, `${rodape.ambiente} · Página ${k + 1} de ${paginas.length}`, M, 16, { size: 7, color: SUAVE, largura: util, direita: true });
  });
  return pdf.save();
}

/** Nome do arquivo: "faturamento-mensal-seila-peres-2026.pdf". */
export function nomeArquivo(r: Relatorio, ext: "pdf" | "xlsx"): string {
  const s = `${r.titulo} ${r.subtitulo}`
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
  return `${s || "relatorio"}.${ext}`;
}
