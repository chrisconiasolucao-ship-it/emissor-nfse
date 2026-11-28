/**
 * NFS-e importadas (ADN ou XML enviado) junto com as notas do sistema: a tela Notas e o faturamento do painel
 * mostram as duas. Uma nota emitida aqui também volta pelo ADN; ela conta uma vez só (fica a do sistema),
 * pela chave empresa + número da NFS-e.
 */
export type Importada = {
  id: string;
  empresa_id: string;
  papel: string | null;
  outra_parte: string | null;
  outra_parte_documento: string | null;
  numero_nfse: string | null;
  competencia: string | null;
  valor: string | number | null;
  nome_original: string | null;
};

export const COLUNAS_IMPORTADA = "id, empresa_id, papel, outra_parte, outra_parte_documento, numero_nfse, competencia, valor, nome_original";

const chave = (empresaId: string, numero: string | null | undefined) => `${empresaId}|${String(numero ?? "").replace(/^0+/, "")}`;

/** Tira as importadas que já existem como nota do sistema (mesma empresa e mesmo número de NFS-e). */
export function semDuplicadas<T extends { empresa_id: string; numero_nfse: string | null }>(
  importadas: T[],
  doSistema: { empresa_id: string; numero_nfse: string | null }[],
): T[] {
  const ja = new Set(doSistema.filter((n) => n.numero_nfse).map((n) => chave(n.empresa_id, n.numero_nfse)));
  return importadas.filter((d) => !d.numero_nfse || !ja.has(chave(d.empresa_id, d.numero_nfse)));
}

/**
 * Período da tela Notas: de/até em "AAAA-MM". Sem nenhum parâmetro de período, abre no mês atual;
 * com os campos vazios (o usuário limpou), mostra todos os meses. "competencia" antigo vale como de = até.
 */
export function periodo(
  busca: { de?: string; ate?: string; competencia?: string },
  mesAtual: string,
): { de?: string; ate?: string } {
  const ok = (v?: string) => (v && /^\d{4}-\d{2}$/.test(v) ? v : undefined);
  if (busca.de === undefined && busca.ate === undefined) {
    const c = ok(busca.competencia);
    if (c) return { de: c, ate: c };
    if (busca.competencia === "") return {};
    return { de: mesAtual, ate: mesAtual };
  }
  let de = ok(busca.de);
  let ate = ok(busca.ate);
  if (de && ate && de > ate) [de, ate] = [ate, de];
  return { de, ate };
}
