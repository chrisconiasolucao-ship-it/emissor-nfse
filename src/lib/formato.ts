/** Formatos de exibição (só tela): CPF/CNPJ com pontuação e código de tributação nacional como 01.07.01. */
export function documento(d: string | null | undefined): string {
  const s = String(d ?? "").replace(/\D/g, "");
  if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  return String(d ?? "");
}

export function codigoServico(c: string | null | undefined): string {
  const s = String(c ?? "");
  return /^\d{6}$/.test(s) ? `${s.slice(0, 2)}.${s.slice(2, 4)}.${s.slice(4)}` : s;
}
