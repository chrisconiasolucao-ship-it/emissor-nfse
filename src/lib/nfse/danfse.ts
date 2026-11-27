import { XMLParser } from "fast-xml-parser";
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";
import QRCode from "qrcode";
import { lerValor } from "@/lib/money";

/**
 * DANFSe gerado pelo próprio sistema a partir do XML autorizado, no leiaute da NT 008 SE/CGNFS-e v1.02
 * (a API oficial de DANFSe foi suspensa em 03/08/2026). A4 retrato, uma página, medidas da tabela 2.4.5 em cm.
 * Arial/Microsoft Sans Serif são substituídas por Helvetica (fonte padrão do PDF, métrica equivalente).
 */
export type SituacaoDanfse = "autorizada" | "cancelada" | "substituida";
export type NomeMunicipio = (codIbge: string) => Promise<string | null> | string | null;

const CM = 28.3465;
const ALTURA_A4 = 841.89;
const LARGURA_A4 = 595.28;
const X0 = 0.3;
const LARGURA = 20.4;
const COL = [0.3, 5.41, 10.51, 15.62];
const L1 = 5.09;
const L2 = 10.19;
const PRETO = rgb(0, 0, 0);
const CINZA_FUNDO = rgb(0.95, 0.95, 0.95);
const VERMELHO = rgb(0.85, 0, 0);
const CINZA_MARCA = rgb(0.65, 0.65, 0.65);
const URL_CONSULTA = "https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=";

const OPCOES = {
  tpEmit: { "1": "Prestador", "2": "Tomador", "3": "Intermediário" },
  cStat: { "100": "NFS-e Gerada", "101": "NFS-e de Substituição Gerada", "102": "NFS-e de Decisão Judicial", "103": "NFS-e Avulsa", "107": "NFS-e MEI" },
  finNFSe: { "0": "NFS-e regular" },
  opSimpNac: { "1": "Não Optante", "2": "Optante - Microempreendedor Individual (MEI)", "3": "Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)" },
  regApTribSN: {
    "1": "Regime de apuração dos tributos federais e municipal pelo SN",
    "2": "Tributos federais pelo SN e ISSQN por fora do SN conforme legislação municipal",
    "3": "Tributos federais e municipal por fora do SN conforme legislações respectivas",
  },
  tribISSQN: { "1": "Operação Tributável", "2": "Imunidade", "3": "Exportação de Serviço", "4": "Não Incidência" },
  regEspTrib: { "0": "Nenhum", "1": "Ato Cooperado (Cooperativa)", "2": "Estimativa", "3": "Microempresa Municipal", "4": "Notário ou Registrador", "5": "Profissional Autônomo", "6": "Sociedade de Profissionais", "9": "Outros" },
  tpRetISSQN: { "1": "Não Retido", "2": "Retido pelo Tomador", "3": "Retido pelo Intermediário" },
  tpImunidade: { "0": "Imunidade (tipo não informado)", "1": "Patrimônio, renda ou serviços", "2": "Templos de qualquer culto", "3": "Partidos, sindicatos, educação e assistência", "4": "Livros, jornais e periódicos", "5": "Fonogramas e videofonogramas" },
  tpSusp: { "1": "Exigibilidade Suspensa por Decisão Judicial", "2": "Exigibilidade Suspensa por Processo Administrativo" },
  tpBM: { "1": "Isenção", "2": "Redução da BC em %", "3": "Redução da BC em R$", "4": "Alíquota Diferenciada" },
  tpRetPisCofins: {
    "0": "PIS/COFINS/CSLL Não Retidos", "1": "PIS/COFINS Retidos", "2": "PIS/COFINS Não Retidos", "3": "PIS/COFINS/CSLL Retidos",
    "4": "PIS/COFINS Retidos, CSLL Não Retido", "5": "PIS Retido, COFINS/CSLL Não Retido", "6": "COFINS Retido, PIS/CSLL Não Retido",
    "7": "PIS Não Retido, COFINS/CSLL Retidos", "8": "PIS/COFINS Não Retidos, CSLL Retido", "9": "COFINS Não Retido, PIS/CSLL Retidos",
  },
} as const;

type No = Record<string, unknown>;
const no = (x: unknown): No => (x && typeof x === "object" ? (x as No) : {});
const txt = (x: unknown): string | null => (x == null || typeof x === "object" || String(x) === "" ? null : String(x));
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false, trimValues: true });

const TRACO = "-";
const opcao = (tabela: Record<string, string>, v: string | null) => (v == null ? TRACO : (tabela[v] ?? v));

export function mascaraDocumento(d: No): string {
  const cnpj = txt(d.CNPJ);
  if (cnpj) return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  const cpf = txt(d.CPF);
  if (cpf) return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return txt(d.NIF) ?? TRACO;
}

/** "1350.00" → "R$ 1.350,00"; ausente → "-". */
export function moeda(v: string | null): string {
  if (v == null) return TRACO;
  const [int, dec] = lerValor(v).toFixed(2).split(".");
  return `R$ ${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}
const percentual = (v: string | null) => (v == null ? TRACO : `${lerValor(v).toFixed(2).replace(".", ",")}%`);

/** "2026-11-26T15:30:07-03:00" → "26/11/2026 15:30:07" (hora local do XML). */
export function dataHora(v: string | null): string {
  if (!v) return TRACO;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}:\d{2}))?/);
  return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}` : ""}` : v;
}

const codigoTrib = (c: string | null) => (c && /^\d{6}$/.test(c) ? `${c.slice(0, 2)}.${c.slice(2, 4)}.${c.slice(4)}` : (c ?? TRACO));
const codigoNbs = (c: string | null) => (c && /^\d{9}$/.test(c) ? `${c[0]}.${c.slice(1, 5)}.${c.slice(5, 7)}.${c.slice(7)}` : (c ?? TRACO));
const cep = (c: string | null) => (c && /^\d{8}$/.test(c) ? `${c.slice(0, 2)}.${c.slice(2, 5)}-${c.slice(5)}` : c);

/** Fontes padrão do PDF usam WinAnsi: troca o que não cabe nela (ex.: travessão longo, emoji). */
function limpo(s: string): string {
  return s
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

type Pessoa = { doc: string; im: string; fone: string; nome: string; municipio: string; ibgeCep: string; endereco: string; email: string };

async function pessoa(p: No, nomeMun: NomeMunicipio, extra?: { nome?: string | null; end?: No; municipio?: string | null }): Promise<Pessoa> {
  const end = no(p.end);
  const nac = no(end.endNac);
  const ext = no(end.endExt);
  const endExtra = no(extra?.end);
  const cMun = txt(nac.cMun) ?? txt(endExtra.cMun);
  const cepTxt = txt(nac.CEP) ?? txt(endExtra.CEP);
  const lgr = txt(end.xLgr) ?? txt(endExtra.xLgr);
  const partes = [lgr, txt(end.nro) ?? txt(endExtra.nro), txt(end.xCpl) ?? txt(endExtra.xCpl), txt(end.xBairro) ?? txt(endExtra.xBairro)].filter(Boolean);
  const municipio = extra?.municipio ?? (cMun ? await nomeMun(cMun) : txt(ext.xCidade));
  return {
    doc: mascaraDocumento(p),
    im: txt(p.IM) ?? TRACO,
    fone: txt(p.fone) ?? TRACO,
    nome: txt(p.xNome) ?? extra?.nome ?? TRACO,
    municipio: municipio ?? TRACO,
    ibgeCep: cMun ? `${cMun} / ${cep(cepTxt) ?? TRACO}` : (txt(ext.cEndPost) ?? TRACO),
    endereco: partes.length ? partes.join(", ") : TRACO,
    email: txt(p.email) ?? TRACO,
  };
}

class Desenho {
  y = 0; // cm a partir do topo
  constructor(public page: PDFPage, public normal: PDFFont, public negrito: PDFFont) {}

  private py(cm: number) {
    return ALTURA_A4 - cm * CM;
  }
  caixa(esq: number, sup: number, larg: number, alt: number, fundo?: boolean) {
    this.page.drawRectangle({
      x: esq * CM, y: this.py(sup + alt), width: larg * CM, height: alt * CM,
      color: fundo ? CINZA_FUNDO : undefined, borderColor: PRETO, borderWidth: 0.5,
    });
  }
  /** Corta com reticências para caber na largura e no máximo de caracteres. */
  cabe(texto: string, fonte: PDFFont, tam: number, larguraCm: number, max = 2000): string {
    let t = limpo(texto);
    if (t.length > max) t = t.slice(0, max - 3) + "...";
    const limite = larguraCm * CM - 4;
    if (fonte.widthOfTextAtSize(t, tam) <= limite) return t;
    while (t.length > 1 && fonte.widthOfTextAtSize(t + "...", tam) > limite) t = t.slice(0, -1);
    return t + "...";
  }
  texto(t: string, esqCm: number, baseCm: number, tam: number, fonte: PDFFont, cor = PRETO) {
    this.page.drawText(t, { x: esqCm * CM, y: this.py(baseCm), size: tam, font: fonte, color: cor });
  }
  centro(t: string, esqCm: number, largCm: number, baseCm: number, tam: number, fonte: PDFFont, cor = PRETO) {
    const s = limpo(t);
    const w = fonte.widthOfTextAtSize(s, tam);
    this.page.drawText(s, { x: esqCm * CM + (largCm * CM - w) / 2, y: this.py(baseCm), size: tam, font: fonte, color: cor });
  }
  /** Campo: rótulo 6 pt negrito em cima, conteúdo 7 pt embaixo. */
  campo(rotulo: string, valor: string, esq: number, larg: number, opts: { alt?: number; fundo?: boolean; rotuloCaixaAlta?: boolean; max?: number } = {}) {
    const alt = opts.alt ?? 0.645;
    if (opts.fundo) this.caixa(esq, this.y, larg, alt, true);
    const rot = opts.rotuloCaixaAlta ? rotulo.toUpperCase() : rotulo;
    this.texto(this.cabe(rot, this.negrito, opts.rotuloCaixaAlta ? 7 : 6, larg), esq + 0.07, this.y + 0.25, opts.rotuloCaixaAlta ? 7 : 6, this.negrito);
    this.texto(this.cabe(valor, this.normal, 7, larg, opts.max), esq + 0.07, this.y + 0.55, 7, this.normal);
  }
  tituloBloco(t: string, alt = 0.645) {
    this.caixa(X0, this.y, L1, alt, true);
    this.texto(this.cabe(t.toUpperCase(), this.negrito, 7, L1), X0 + 0.07, this.y + 0.4, 7, this.negrito);
  }
  linhaDivisoria(supCm: number) {
    this.page.drawLine({ start: { x: X0 * CM, y: this.py(supCm) }, end: { x: (X0 + LARGURA) * CM, y: this.py(supCm) }, thickness: 0.5, color: PRETO });
  }
  /** Bloco não preenchido: só o texto fixo, 0,32 cm. */
  textoFixo(t: string) {
    this.linhaDivisoria(this.y);
    this.texto(this.cabe(t, this.negrito, 7, LARGURA), X0 + 0.07, this.y + 0.28, 7, this.negrito);
    this.y += 0.4;
  }
  /** Texto corrido com quebra de linha dentro de uma área. Devolve a altura usada. */
  paragrafo(t: string, esq: number, larg: number, sup: number, altMax: number, tam = 7): number {
    const palavras = limpo(t).split(" ");
    const linhas: string[] = [];
    let atual = "";
    for (const p of palavras) {
      const tentativa = atual ? `${atual} ${p}` : p;
      if (this.normal.widthOfTextAtSize(tentativa, tam) > larg * CM - 6 && atual) {
        linhas.push(atual);
        atual = p;
      } else atual = tentativa;
    }
    if (atual) linhas.push(atual);
    const entrelinha = (tam + 1.5) / CM;
    const cabem = Math.max(1, Math.floor(altMax / entrelinha));
    const usadas = linhas.slice(0, cabem);
    if (linhas.length > cabem) usadas[cabem - 1] = this.cabe(usadas[cabem - 1] + "...", this.normal, tam, larg);
    usadas.forEach((l, i) => this.texto(l, esq + 0.07, sup + entrelinha * (i + 1), tam, this.normal));
    return usadas.length * entrelinha + 0.1;
  }
}

/** Gera o DANFSe (PDF) a partir do XML da NFS-e autorizada. */
export async function gerarDanfse(xml: string, opts: { nomeMunicipio?: NomeMunicipio; situacao?: SituacaoDanfse } = {}): Promise<Buffer> {
  const nomeMun: NomeMunicipio = opts.nomeMunicipio ?? ((c) => c);
  const raiz = no(parser.parse(xml));
  const inf = no(no(raiz.NFSe).infNFSe);
  const dps = no(no(inf.DPS).infDPS);
  if (!Object.keys(inf).length || !Object.keys(dps).length) throw new Error("XML não é uma NFS-e autorizada do padrão nacional");

  const chave = (txt(inf["@Id"]) ?? "").replace(/^NFS/, "");
  const emit = no(inf.emit);
  const emitEnd = no(emit.enderNac);
  const prest = no(dps.prest);
  const regTrib = no(prest.regTrib);
  const serv = no(dps.serv);
  const cServ = no(serv.cServ);
  const valoresDps = no(dps.valores);
  const trib = no(valoresDps.trib);
  const tribMun = no(trib.tribMun);
  const tribFed = no(trib.tribFed);
  const piscofins = no(tribFed.piscofins);
  const totTrib = no(trib.totTrib);
  const valoresNfse = no(inf.valores);
  const descontos = no(valoresDps.vDescCondIncond);
  const tpAmb = txt(dps.tpAmb);

  const doc = await PDFDocument.create();
  doc.setTitle(`DANFSe ${txt(inf.nNFSe) ?? ""} - ${chave}`);
  doc.setProducer("Emissor NFS-e CHRISCON");
  const page = doc.addPage([LARGURA_A4, ALTURA_A4]);
  const d = new Desenho(page, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));

  // CABEÇALHO
  d.caixa(X0, 0.3, LARGURA, 1.16, true);
  d.texto("NFS-e", 0.49, 1.15, 18, d.negrito);
  d.texto("Nota Fiscal de Serviço eletrônica", 0.49, 1.42, 5.5, d.normal);
  d.centro("DANFSe v2.0", 5.41, 10.19, 0.68, 9, d.negrito);
  d.centro("Documento Auxiliar da NFS-e", 5.41, 10.19, 1.02, 9, d.negrito);
  if (tpAmb === "2") d.centro("NFS-e SEM VALIDADE JURÍDICA", 5.41, 10.19, 1.36, 9, d.negrito, VERMELHO);
  const cTribNac = txt(cServ.cTribNac);
  const municipioEmissor = [txt(inf.xLocEmi), txt(emitEnd.UF)].filter(Boolean).join(" / ");
  if (cTribNac?.slice(0, 2) !== "99" && municipioEmissor) d.texto(d.cabe(`Município: ${municipioEmissor}`, d.normal, 8, 5.0), 15.7, 0.75, 8, d.normal);
  d.texto(`Ambiente gerador: ${txt(inf.ambGer) === "1" ? "Prefeitura" : txt(inf.ambGer) === "2" ? "Sistema Nacional NFS-e" : TRACO}`, 15.7, 1.12, 6, d.normal);
  d.texto(`Tipo de ambiente: ${tpAmb === "1" ? "Produção" : tpAmb === "2" ? "Homologação" : TRACO}`, 15.7, 1.38, 6, d.normal);

  // DADOS DA NFS-e
  d.y = 1.48;
  d.campo("Chave de acesso da NFS-e", chave || TRACO, X0, 15.3, { rotuloCaixaAlta: true, alt: 0.77 });
  d.y = 2.27;
  d.campo("Número da NFS-e", txt(inf.nNFSe) ?? TRACO, COL[0]!, L1, { rotuloCaixaAlta: true });
  d.campo("Competência da NFS-e", dataHora(txt(dps.dCompet)), COL[1]!, L1, { rotuloCaixaAlta: true });
  d.campo("Data e hora da emissão da NFS-e", dataHora(txt(inf.dhProc)), COL[2]!, L1, { rotuloCaixaAlta: true });
  d.y = 2.96;
  d.campo("Número da DPS", txt(dps.nDPS) ?? TRACO, COL[0]!, L1, { rotuloCaixaAlta: true });
  d.campo("Série da DPS", txt(dps.serie) ?? TRACO, COL[1]!, L1, { rotuloCaixaAlta: true });
  d.campo("Data e hora da emissão da DPS", dataHora(txt(dps.dhEmi)), COL[2]!, L1, { rotuloCaixaAlta: true });
  d.y = 3.65;
  d.campo("Emitente da NFS-e", opcao(OPCOES.tpEmit, txt(dps.tpEmit)), COL[0]!, L1, { rotuloCaixaAlta: true, fundo: true, alt: 0.67 });
  d.campo("Situação da NFS-e", opcao(OPCOES.cStat, txt(inf.cStat)), COL[1]!, L1, { rotuloCaixaAlta: true, max: 40 });
  d.campo("Finalidade", opcao(OPCOES.finNFSe, txt(dps.finNFSe) ?? txt(no(dps.IBSCBS).finNFSe)), COL[2]!, L1, { rotuloCaixaAlta: true, max: 40 });

  // QR Code
  const qr = QRCode.create(URL_CONSULTA + chave, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const lado = 1.52;
  const modulo = (lado * CM) / n;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) page.drawRectangle({ x: 17.48 * CM + c * modulo, y: ALTURA_A4 - 1.67 * CM - (r + 1) * modulo, width: modulo, height: modulo, color: PRETO });
    }
  }
  d.centro("A autenticidade desta NFS-e pode ser verificada", 15.8, 4.72, 3.55, 6, d.normal);
  d.centro("pela leitura deste código QR ou pela consulta da", 15.8, 4.72, 3.8, 6, d.normal);
  d.centro("chave de acesso no portal nacional da NFS-e", 15.8, 4.72, 4.05, 6, d.normal);
  d.linhaDivisoria(1.48);
  d.linhaDivisoria(4.34);

  // PRESTADOR / FORNECEDOR
  d.y = 4.34;
  const pr = await pessoa(prest, nomeMun, { nome: txt(emit.xNome), end: emitEnd, municipio: municipioEmissor || null });
  if (pr.fone === TRACO && txt(emit.fone)) pr.fone = String(emit.fone);
  if (pr.email === TRACO && txt(emit.email)) pr.email = String(emit.email);
  d.tituloBloco("Prestador / Fornecedor");
  d.campo("CNPJ / CPF / NIF", pr.doc, COL[1]!, L1);
  d.campo("Indicador Municipal (Inscrição)", pr.im, COL[2]!, L1);
  d.campo("Telefone", pr.fone, COL[3]!, L1);
  d.y += 0.645;
  d.campo("Nome / Nome Empresarial", pr.nome, COL[0]!, L2, { max: 80 });
  d.campo("Município / Sigla UF", pr.municipio, COL[2]!, L1, { max: 37 });
  d.campo("Código IBGE / CEP", pr.ibgeCep, COL[3]!, L1);
  d.y += 0.645;
  d.campo("Endereço", pr.endereco, COL[0]!, L2, { max: 80 });
  d.campo("Email", pr.email, COL[2]!, L2, { max: 80 });
  d.y += 0.645;
  d.campo("Simples Nacional na Data de Competência", opcao(OPCOES.opSimpNac, txt(regTrib.opSimpNac)), COL[0]!, L2, { max: 40 });
  d.campo("Regime de Apuração Tributária pelo SN", opcao(OPCOES.regApTribSN, txt(regTrib.regApTribSN)), COL[2]!, L2, { max: 80 });
  d.y += 0.645;

  // TOMADOR / ADQUIRENTE
  const toma = no(dps.toma);
  if (Object.keys(toma).length) {
    d.linhaDivisoria(d.y);
    const tm = await pessoa(toma, nomeMun);
    d.tituloBloco("Tomador / Adquirente");
    d.campo("CNPJ / CPF / NIF", tm.doc, COL[1]!, L1);
    d.campo("Indicador Municipal (Inscrição)", tm.im, COL[2]!, L1);
    d.campo("Telefone", tm.fone, COL[3]!, L1);
    d.y += 0.645;
    d.campo("Nome / Nome Empresarial", tm.nome, COL[0]!, L2, { max: 80 });
    d.campo("Município / Sigla UF", tm.municipio, COL[2]!, L1, { max: 37 });
    d.campo("Código IBGE / CEP", tm.ibgeCep, COL[3]!, L1);
    d.y += 0.645;
    if (tm.endereco !== TRACO || tm.email !== TRACO) {
      d.campo("Endereço", tm.endereco, COL[0]!, L2, { max: 80 });
      d.campo("E-mail", tm.email, COL[2]!, L2, { max: 80 });
      d.y += 0.645;
    }
  } else d.textoFixo("TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e");

  // DESTINATÁRIO
  const dest = no(dps.dest ?? no(dps.IBSCBS).dest);
  if (Object.keys(dest).length) {
    d.linhaDivisoria(d.y);
    const ds = await pessoa(dest, nomeMun);
    d.tituloBloco("Destinatário da Operação");
    d.campo("CNPJ / CPF / NIF", ds.doc, COL[1]!, L1);
    d.campo("Telefone", ds.fone, COL[3]!, L1);
    d.y += 0.645;
    d.campo("Nome / Nome Empresarial", ds.nome, COL[0]!, L2, { max: 80 });
    d.campo("Município / Sigla UF", ds.municipio, COL[2]!, L1, { max: 37 });
    d.campo("Código IBGE / CEP", ds.ibgeCep, COL[3]!, L1);
    d.y += 0.645;
  } else if (Object.keys(toma).length && txt(dps.indDest) !== "1") d.textoFixo("O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO");
  else d.textoFixo("DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e");

  // INTERMEDIÁRIO
  const interm = no(dps.interm);
  if (Object.keys(interm).length) {
    d.linhaDivisoria(d.y);
    const it = await pessoa(interm, nomeMun);
    d.tituloBloco("Intermediário da Operação");
    d.campo("CNPJ / CPF / NIF", it.doc, COL[1]!, L1);
    d.campo("Indicador Municipal (Inscrição)", it.im, COL[2]!, L1);
    d.campo("Telefone", it.fone, COL[3]!, L1);
    d.y += 0.645;
    d.campo("Nome / Nome Empresarial", it.nome, COL[0]!, L2, { max: 80 });
    d.campo("Município / Sigla UF", it.municipio, COL[2]!, L1, { max: 37 });
    d.campo("Código IBGE / CEP", it.ibgeCep, COL[3]!, L1);
    d.y += 0.645;
  } else d.textoFixo("INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e");

  // SERVIÇO PRESTADO
  d.linhaDivisoria(d.y);
  d.tituloBloco("Serviço Prestado");
  const cTribMun = txt(no(cServ.cTribMun)["#text"] ?? cServ.cTribMun);
  d.campo("Código de Tributação Nacional / Municipal", `${codigoTrib(cTribNac)} / ${cTribMun ?? TRACO}`, COL[1]!, L1);
  d.campo("Código da NBS", codigoNbs(txt(cServ.cNBS)), COL[2]!, L1);
  const cLocPrest = txt(no(serv.locPrest).cLocPrestacao);
  const localPrest = cLocPrest ? await nomeMun(cLocPrest) : null;
  d.campo("Local da Prestação / Sigla UF / País", `${localPrest ?? txt(inf.xLocPrestacao) ?? TRACO} / ${txt(no(serv.locPrest).cPaisPrestacao) ?? "BR"}`, COL[3]!, L1, { max: 42 });
  d.y += 0.645;
  const descTrib = txt(inf.xTribMun) ?? txt(inf.xTribNac) ?? TRACO;
  d.texto(d.cabe(descTrib, d.normal, 7, LARGURA, 170), X0 + 0.07, d.y + 0.3, 7, d.normal);
  d.y += 0.4;
  d.texto("Descrição do Serviço", X0 + 0.07, d.y + 0.25, 6, d.negrito);
  d.y += d.paragrafo(txt(cServ.xDescServ) ?? TRACO, X0, LARGURA, d.y + 0.25, 2.4) + 0.25;

  // TRIBUTAÇÃO MUNICIPAL
  d.linhaDivisoria(d.y);
  if (Object.keys(tribMun).length) {
    d.tituloBloco("Tributação Municipal (ISSQN)");
    const incid = txt(inf.cLocIncid) ? await nomeMun(String(inf.cLocIncid)) : null;
    d.campo("Tipo de Tributação do ISSQN", opcao(OPCOES.tribISSQN, txt(tribMun.tribISSQN)), COL[1]!, L1);
    d.campo("Município / Sigla UF / País da Incidência do ISSQN", `${incid ?? txt(inf.xLocIncid) ?? TRACO} / ${txt(tribMun.cPaisResult) ?? "BR"}`, COL[2]!, L2, { max: 42 });
    d.y += 0.645;
    const exig = no(tribMun.exigSusp);
    const bm = no(tribMun.BM);
    if (txt(tribMun.tpImunidade) || txt(exig.tpSusp) || (txt(regTrib.regEspTrib) ?? "0") !== "0") {
      d.campo("Regime Especial de Tributação do ISSQN", opcao(OPCOES.regEspTrib, txt(regTrib.regEspTrib)), COL[0]!, L1);
      d.campo("Tipo de Imunidade do ISSQN", opcao(OPCOES.tpImunidade, txt(tribMun.tpImunidade)), COL[1]!, L1, { max: 40 });
      d.campo("Suspensão da Exigibilidade do ISSQN", opcao(OPCOES.tpSusp, txt(exig.tpSusp)), COL[2]!, L1, { max: 40 });
      d.campo("Número Processo Suspensão", txt(exig.nProcesso) ?? TRACO, COL[3]!, L1);
      d.y += 0.645;
    }
    if (txt(valoresNfse.tpBM) || txt(valoresNfse.vCalcBM) || txt(valoresDps.vDedRed) || txt(descontos.vDescIncond)) {
      d.campo("Benefício Municipal", opcao(OPCOES.tpBM, txt(valoresNfse.tpBM)), COL[0]!, L1, { max: 40 });
      d.campo("Cálculo do BM", moeda(txt(valoresNfse.vCalcBM) ?? txt(bm.vRedBCBM)), COL[1]!, L1);
      d.campo("Total Deduções/Reduções", moeda(txt(no(valoresDps.vDedRed).vDR) ?? txt(valoresNfse.vCalcDR)), COL[2]!, L1);
      d.campo("Desconto Incondicionado", moeda(txt(descontos.vDescIncond)), COL[3]!, L1);
      d.y += 0.645;
    }
    d.campo("BC ISSQN", moeda(txt(valoresNfse.vBC)), COL[0]!, L1);
    d.campo("Alíquota Aplicada", percentual(txt(valoresNfse.pAliqAplic)), COL[1]!, L1);
    d.campo("Retenção do ISSQN", opcao(OPCOES.tpRetISSQN, txt(tribMun.tpRetISSQN)), COL[2]!, L1);
    d.campo("ISSQN Apurado", moeda(txt(valoresNfse.vISSQN)), COL[3]!, L1);
    d.y += 0.645;
  } else d.textoFixo("TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN");

  // TRIBUTAÇÃO FEDERAL (EXCETO CBS)
  d.linhaDivisoria(d.y);
  d.tituloBloco("Tributação Federal (Exceto CBS)");
  const tpRetPC = txt(piscofins.tpRetPisCofins);
  const vPis = txt(piscofins.vPis);
  const vCofins = txt(piscofins.vCofins);
  const vCsll = txt(tribFed.vRetCSLL);
  // soma o que o tpRetPisCofins diz que foi retido (PIS, COFINS e CSLL)
  const pisRet = ["1", "3", "4", "5", "9"].includes(tpRetPC ?? "");
  const cofinsRet = ["1", "3", "4", "6", "7"].includes(tpRetPC ?? "");
  const partesRet = [vCsll, pisRet ? vPis : null, cofinsRet ? vCofins : null];
  const contribRetidas = partesRet.some((v) => v) ? partesRet.reduce((s, v) => s.plus(lerValor(v ?? "0")), lerValor("0")).toFixed(2) : null;
  d.campo("IRRF", moeda(txt(tribFed.vRetIRRF)), COL[1]!, L1);
  d.campo("Contribuição Previdenciária - Retida", moeda(txt(tribFed.vRetCP)), COL[2]!, L1);
  d.campo("Contribuições Sociais - Retidas", moeda(contribRetidas), COL[3]!, L1);
  d.y += 0.645;
  const competencia = txt(dps.dCompet) ?? "";
  if (competencia < "2027-01-01") {
    d.campo("PIS - Débito Apuração Própria", tpRetPC === "1" ? moeda("0") : moeda(vPis), COL[0]!, L1);
    d.campo("COFINS - Débito Apuração Própria", tpRetPC === "1" ? moeda("0") : moeda(vCofins), COL[1]!, L1);
    d.campo("Descrição Contrib. Sociais - Retidas", opcao(OPCOES.tpRetPisCofins, tpRetPC), COL[2]!, L2, { max: 35 });
    d.y += 0.645;
  }

  // TRIBUTAÇÃO IBS / CBS (vazia enquanto a nota não traz o grupo)
  const ibscbs = no(inf.IBSCBS);
  const totCIBS = no(ibscbs.totCIBS);
  const gIBS = no(totCIBS.gIBS);
  const gCBS = no(totCIBS.gCBS);
  d.linhaDivisoria(d.y);
  d.tituloBloco("Tributação IBS / CBS");
  const gTribSN = no(totCIBS.gTribSN);
  const tribDps = no(no(no(dps.IBSCBS).valores).trib);
  if (Object.keys(gTribSN).length) {
    // Simples Nacional (NT 009): a Sefin calcula IBS e CBS sobre a receita bruta do SN
    const cst = [txt(tribDps.CST), txt(tribDps.cClassTrib)].filter(Boolean).join(" / ");
    d.campo("CST / cClassTrib", cst || TRACO, COL[0]!, L1);
    d.campo("Receita Bruta - Simples Nacional", moeda(txt(no(ibscbs.valores).vReceitaBrutaSN)), COL[1]!, L1);
    d.campo(`IBS - Simples Nacional${txt(gTribSN.pIBSSN) ? ` (${percentual(txt(gTribSN.pIBSSN))})` : ""}`, moeda(txt(gTribSN.vIBSSN)), COL[2]!, L1);
    d.campo(`CBS - Simples Nacional${txt(gTribSN.pCBSSN) ? ` (${percentual(txt(gTribSN.pCBSSN))})` : ""}`, moeda(txt(gTribSN.vCBSSN)), COL[3]!, L1);
  } else if (Object.keys(ibscbs).length) {
    const vIbsCbs = no(ibscbs.valores);
    d.campo("Base de Cálculo Após Exclusões e Reduções", moeda(txt(vIbsCbs.vBC)), COL[1]!, L1);
    d.campo("Valor Total Apurado - IBS", moeda(txt(gIBS.vIBSTot)), COL[2]!, L1);
    d.campo("Valor Total Apurado - CBS", moeda(txt(gCBS.vCBS)), COL[3]!, L1);
  } else {
    d.texto("Sem informação de IBS/CBS nesta NFS-e", COL[1]! + 0.07, d.y + 0.4, 7, d.normal);
  }
  d.y += 0.645;

  // VALOR TOTAL DA NFS-e
  d.linhaDivisoria(d.y);
  d.tituloBloco("Valor Total da NFS-e", 0.67);
  d.campo("Valor da Operação / Serviço", moeda(txt(no(valoresDps.vServPrest).vServ)), COL[1]!, L1);
  d.campo("Desconto Incondicionado", moeda(txt(descontos.vDescIncond)), COL[2]!, L1);
  d.campo("Desconto Condicionado", moeda(txt(descontos.vDescCond)), COL[3]!, L1);
  d.y += 0.69;
  const totIbsCbs = txt(gIBS.vIBSTot) || txt(gCBS.vCBS)
    ? lerValor(txt(gIBS.vIBSTot) ?? "0").plus(lerValor(txt(gCBS.vCBS) ?? "0")).toFixed(2)
    : txt(gTribSN.vIBSSN) || txt(gTribSN.vCBSSN)
      ? lerValor(txt(gTribSN.vIBSSN) ?? "0").plus(lerValor(txt(gTribSN.vCBSSN) ?? "0")).toFixed(2)
      : null;
  d.campo("Total das Retenções (ISSQN / Federais)", moeda(txt(valoresNfse.vTotalRet)), COL[0]!, L1);
  d.campo("Valor Líquido da NFS-e", moeda(txt(valoresNfse.vLiq)), COL[1]!, L1);
  d.campo("Total do IBS/CBS", moeda(totIbsCbs), COL[2]!, L1);
  d.campo("Valor Líquido da NFS-e + IBS/CBS", moeda(txt(totCIBS.vTotNF) ?? txt(valoresNfse.vLiq)), COL[3]!, L1, { fundo: true });
  d.y += 0.69;

  // INFORMAÇÕES COMPLEMENTARES
  d.linhaDivisoria(d.y);
  d.caixa(X0, d.y, LARGURA, 0.39, true);
  d.texto("INFORMAÇÕES COMPLEMENTARES", X0 + 0.07, d.y + 0.29, 7, d.negrito);
  d.y += 0.41;
  const ic = no(serv.infoCompl);
  const subst = no(dps.subst);
  const partes = [
    ["Inf. Cont.:", txt(ic.xInfComp)],
    ["NFS-e Subst.:", txt(subst.chSubstda)],
    ["Doc. Ref.:", txt(ic.docRef)],
    ["Cod. Obra:", txt(no(serv.obra).cObra)],
    ["Insc. Imob.:", txt(no(serv.obra).inscImobFisc)],
    ["Cod. Evt.:", txt(no(serv.atvEvento).idAtvEvt)],
    ["Doc. Tec.:", txt(ic.idDocTec)],
    ["Núm. Ped.:", txt(ic.xPed)],
    ["Item Ped.:", txt(ic.xItemPed)],
    ["Inf. A. T. Mun.:", txt(inf.xOutInf)],
  ].filter(([, v]) => v).map(([r, v]) => `${r} ${v}`);
  let totais: string;
  if (txt(totTrib.pTotTribSN)) totais = `Simples Nacional: ${percentual(txt(totTrib.pTotTribSN))}`;
  else if (Object.keys(no(totTrib.vTotTrib)).length) {
    const v = no(totTrib.vTotTrib);
    totais = `Federais: ${moeda(txt(v.vTotTribFed))} ; Estaduais: ${moeda(txt(v.vTotTribEst))} ; Municipais: ${moeda(txt(v.vTotTribMun))}`;
  } else if (Object.keys(no(totTrib.pTotTrib)).length) {
    const p = no(totTrib.pTotTrib);
    totais = `Federais: ${percentual(txt(p.pTotTribFed))} ; Estaduais: ${percentual(txt(p.pTotTribEst))} ; Municipais: ${percentual(txt(p.pTotTribMun))}`;
  } else totais = "Não informados (Decreto 8.264/2014)";
  const texto = [...partes, `Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: ${totais}`].join(" | ");
  d.y += d.paragrafo(texto, X0, LARGURA, d.y, Math.max(1, 28.0 - d.y));

  // borda externa da área usada
  page.drawRectangle({ x: X0 * CM, y: ALTURA_A4 - d.y * CM, width: LARGURA * CM, height: (d.y - 0.3) * CM, borderColor: PRETO, borderWidth: 1 });

  // marca d'água de cancelamento/substituição
  if (opts.situacao === "cancelada" || opts.situacao === "substituida") {
    const marca = opts.situacao === "cancelada" ? "CANCELADA" : "SUBSTITUÍDA";
    const tam = 90;
    const w = d.negrito.widthOfTextAtSize(limpo(marca), tam);
    page.drawText(limpo(marca), { x: LARGURA_A4 / 2 - (w / 2) * Math.cos(Math.PI / 4), y: ALTURA_A4 / 2 - (w / 2) * Math.sin(Math.PI / 4), size: tam, font: d.normal, color: CINZA_MARCA, rotate: degrees(45), opacity: 0.6 });
  }

  return Buffer.from(await doc.save());
}
