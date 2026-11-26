/**
 * Papéis (AT-009, AT-014, AT-026). O banco repete estas regras (RLS e funções security definer);
 * aqui elas servem para esconder botões e recusar cedo, com mensagem clara.
 */
export type Papel = "escritorio_admin" | "escritorio_operador" | "cliente_admin" | "cliente_usuario";
export type Perfil = { usuarioId: string; papel: Papel; empresaId: string | null; ativo: boolean };

export class AcessoNegado extends Error {
  constructor(mensagem = "Você não tem permissão para esta ação.") {
    super(mensagem);
  }
}

export const eEscritorio = (p: Perfil) => p.ativo && (p.papel === "escritorio_admin" || p.papel === "escritorio_operador");

export const podeVer = (p: Perfil, empresaId: string) => p.ativo && (eEscritorio(p) || p.empresaId === empresaId);

export const podeEmitir = podeVer;

/** Cancelar e substituir: escritório ou admin do cliente, nunca o usuário comum (AT-014). */
export const podeCancelarOuSubstituir = (p: Perfil, empresaId: string) =>
  p.ativo && (eEscritorio(p) || (p.papel === "cliente_admin" && p.empresaId === empresaId));

/** Certificado, empresa, município: só o escritório. */
export const podeGerirCertificado = (p: Perfil) => eEscritorio(p);
export const podeGerirEmpresas = (p: Perfil) => eEscritorio(p);

/** Usuários: escritório em qualquer empresa; admin do cliente só na sua, só com papéis de cliente (AT-026). */
export function podeCriarUsuario(p: Perfil, empresaId: string | null, papelNovo: Papel): boolean {
  if (!p.ativo) return false;
  if (p.papel === "escritorio_admin") return true;
  if (p.papel === "cliente_admin") {
    return empresaId !== null && empresaId === p.empresaId && (papelNovo === "cliente_admin" || papelNovo === "cliente_usuario");
  }
  return false;
}

export function exigir(condicao: boolean, mensagem?: string): void {
  if (!condicao) throw new AcessoNegado(mensagem);
}
