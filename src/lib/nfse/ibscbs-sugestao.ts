/** Sem dependências: usado também na tela (componente de cliente). */
export const unico = (v: string[]) => {
  const u = [...new Set(v)];
  return u.length === 1 ? u[0]! : null;
};

/** Sugestão para a tela do serviço: só preenche quando a correlação oficial tem uma única opção. */
export function sugerirIbsCbs(correlacao: { indOp: string; cClassTrib: string }[]): { cClassTrib: string | null; cIndOp: string | null } {
  const cClassTrib = unico(correlacao.map((c) => c.cClassTrib));
  const cIndOp = cClassTrib ? unico(correlacao.filter((c) => c.cClassTrib === cClassTrib).map((c) => c.indOp)) : null;
  return { cClassTrib, cIndOp };
}
