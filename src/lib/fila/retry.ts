/**
 * Política de novas tentativas (AT-005, Decision 4): falha técnica volta para a fila depois de
 * 5, 15 e 60 minutos; depois da 3ª nova tentativa a nota fica Rejeitada "Receita indisponível".
 * A decisão gravada é a de fn_reagendar (banco); esta função é a mesma regra, para o worker
 * relatar o que vai acontecer e para o teste.
 */
export type Decisao = { acao: "reagendar"; tentativa: number; em: Date; minutos: number } | { acao: "desistir"; tentativa: number; motivo: string };

export function validarPolitica(minutos: number[]): number[] {
  if (minutos.length === 0 || minutos.some((m) => !Number.isInteger(m) || m <= 0)) {
    throw new Error("RETRY_MINUTOS precisa ser uma lista de minutos positivos");
  }
  return minutos;
}

export function decidir(tentativasFeitas: number, minutos: number[], agora: Date, erro: string): Decisao {
  const tentativa = tentativasFeitas + 1;
  const m = minutos[tentativa - 1];
  if (m === undefined) return { acao: "desistir", tentativa, motivo: `Receita indisponível: ${erro.slice(0, 300)}` };
  return { acao: "reagendar", tentativa, minutos: m, em: new Date(agora.getTime() + m * 60_000) };
}
