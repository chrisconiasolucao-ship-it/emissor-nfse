import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Porta única de escrita na trilha de negócio (fn_auditar) e no log de segurança (fn_log_seguranca).
 * As duas chamadas lançam erro se não gravarem: a operação que pediu o registro não conclui (AT-033).
 */
export type RegistroAuditoria = {
  empresaId: string | null;
  acao: string;
  entidade: string;
  entidadeId: string | null;
  antes?: unknown;
  depois?: unknown;
  motivo?: string | null;
  quem?: string | null;
  ip?: string | null;
};

export type EventoSeguranca =
  | "login_ok"
  | "login_falha"
  | "login_bloqueado"
  | "download_documento"
  | "exportacao"
  | "uso_certificado"
  | "envio_certificado"
  | "acesso_negado";

export type RegistroSeguranca = {
  evento: EventoSeguranca;
  usuarioId?: string | null;
  email?: string | null;
  ip?: string | null;
  empresaId?: string | null;
  alvo?: string | null;
  detalhe?: Record<string, unknown> | null;
};

export class FalhaDeRegistro extends Error {}

export async function auditar(db: SupabaseClient, r: RegistroAuditoria): Promise<number> {
  const { data, error } = await db.rpc("fn_auditar", {
    p_empresa_id: r.empresaId,
    p_acao: r.acao,
    p_entidade: r.entidade,
    p_entidade_id: r.entidadeId,
    p_antes: r.antes ?? null,
    p_depois: r.depois ?? null,
    p_motivo: r.motivo ?? null,
    p_quem: r.quem ?? null,
    p_ip: r.ip ?? null,
  });
  if (error || data == null) throw new FalhaDeRegistro(`trilha de auditoria não gravou: ${error?.message ?? "sem id"}`);
  return Number(data);
}

export async function logSeguranca(db: SupabaseClient, r: RegistroSeguranca): Promise<number> {
  const { data, error } = await db.rpc("fn_log_seguranca", {
    p_evento: r.evento,
    p_usuario: r.usuarioId ?? null,
    p_email: r.email ?? null,
    p_ip: r.ip ?? null,
    p_empresa_id: r.empresaId ?? null,
    p_alvo: r.alvo ?? null,
    p_detalhe: r.detalhe ?? null,
  });
  if (error || data == null) throw new FalhaDeRegistro(`log de segurança não gravou: ${error?.message ?? "sem id"}`);
  return Number(data);
}

/** IP de quem chamou, a partir dos cabeçalhos da Vercel. */
export function ipDe(headers: Headers): string | null {
  const v = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip");
  return v && /^[0-9a-fA-F:.]+$/.test(v) ? v : null;
}
