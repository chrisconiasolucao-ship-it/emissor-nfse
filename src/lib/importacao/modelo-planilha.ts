import ExcelJS from "exceljs";

/**
 * Modelo padrão da planilha de notas (o brainstorm registrou que o cliente não tem planilha própria).
 * A ordem e os nomes das colunas são o contrato de planilha.ts.
 */
export const COLUNAS = [
  { chave: "tomador_tipo", titulo: "Tipo do tomador (CPF/CNPJ)", obrigatoria: true, exemplo: "CPF" },
  { chave: "tomador_documento", titulo: "CPF ou CNPJ do tomador", obrigatoria: true, exemplo: "52998224725" },
  { chave: "tomador_nome", titulo: "Nome do tomador", obrigatoria: true, exemplo: "MARIA DE TESTE" },
  { chave: "tomador_email", titulo: "E-mail do tomador", obrigatoria: false, exemplo: "maria@example.com" },
  { chave: "tomador_cep", titulo: "CEP", obrigatoria: false, exemplo: "96400000" },
  { chave: "tomador_cod_municipio", titulo: "Código IBGE do município do tomador", obrigatoria: false, exemplo: "4301602" },
  { chave: "tomador_logradouro", titulo: "Logradouro", obrigatoria: false, exemplo: "RUA DAS FLORES" },
  { chave: "tomador_numero", titulo: "Número", obrigatoria: false, exemplo: "100" },
  { chave: "tomador_complemento", titulo: "Complemento", obrigatoria: false, exemplo: "" },
  { chave: "tomador_bairro", titulo: "Bairro", obrigatoria: false, exemplo: "CENTRO" },
  { chave: "codigo_tributacao_nacional", titulo: "Código de tributação nacional (6 dígitos)", obrigatoria: true, exemplo: "010601" },
  { chave: "codigo_nbs", titulo: "Código NBS (9 dígitos)", obrigatoria: false, exemplo: "113032000" },
  { chave: "descricao", titulo: "Descrição do serviço", obrigatoria: true, exemplo: "Assessoria contábil referente a 11/2026" },
  { chave: "valor", titulo: "Valor do serviço (R$)", obrigatoria: true, exemplo: "1350,00" },
  { chave: "competencia", titulo: "Competência (MM/AAAA)", obrigatoria: true, exemplo: "11/2026" },
  { chave: "iss_retido", titulo: "ISS retido pelo tomador (S/N)", obrigatoria: false, exemplo: "N" },
  { chave: "aliquota_iss", titulo: "Alíquota do ISS (%) se retido", obrigatoria: false, exemplo: "" },
  { chave: "ret_inss", titulo: "INSS retido (%), ex.: 11", obrigatoria: false, exemplo: "" },
  { chave: "ret_irrf", titulo: "IRRF retido (%), ex.: 1,5", obrigatoria: false, exemplo: "" },
  { chave: "ret_csll", titulo: "CSLL retida (%), ex.: 1", obrigatoria: false, exemplo: "" },
  { chave: "ret_pis", titulo: "PIS retido (%), ex.: 0,65", obrigatoria: false, exemplo: "" },
  { chave: "ret_cofins", titulo: "COFINS retida (%), ex.: 3", obrigatoria: false, exemplo: "" },
] as const;

export type ChaveColuna = (typeof COLUNAS)[number]["chave"];

export async function gerarModeloPlanilha(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CHRISCON Emissor NFS-e";
  const ws = wb.addWorksheet("notas");
  ws.addRow(COLUNAS.map((c) => c.chave));
  ws.addRow(COLUNAS.map((c) => c.exemplo));
  ws.getRow(1).font = { bold: true };
  COLUNAS.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(14, c.chave.length + 2);
    col.numFmt = "@"; // texto: CPF/CNPJ e códigos não perdem zero à esquerda
  });
  const ajuda = wb.addWorksheet("instrucoes");
  ajuda.addRow(["Coluna", "O que preencher", "Obrigatória"]);
  for (const c of COLUNAS) ajuda.addRow([c.chave, c.titulo, c.obrigatoria ? "sim" : "não"]);
  ajuda.addRow([]);
  ajuda.addRow(["Até 30 notas por arquivo. Uma linha por nota. Apague a linha de exemplo antes de importar."]);
  ajuda.getRow(1).font = { bold: true };
  ajuda.getColumn(1).width = 30;
  ajuda.getColumn(2).width = 50;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
