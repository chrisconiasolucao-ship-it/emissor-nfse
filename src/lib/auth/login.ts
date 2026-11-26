import type { RegistroSeguranca } from "@/lib/auditoria/audit";

/**
 * Login com bloqueio (AT-023, AT-033; Decision 10): 3 falhas seguidas em 15 min bloqueiam o login por
 * 15 min e liberam sozinhas. A contagem fica no banco (login_tentativa); cada falha, bloqueio e
 * sucesso vai para o log de segurança ANTES de o login concluir.
 */
export type PortasLogin = {
  agora(): Date;
  bloqueadoAte(email: string): Promise<Date | null>;
  entrarComSenha(email: string, senha: string): Promise<{ ok: true; usuarioId: string } | { ok: false }>;
  sair(): Promise<void>;
  registrarTentativa(email: string, ip: string | null, sucesso: boolean): Promise<void>;
  logSeguranca(r: RegistroSeguranca): Promise<void>;
};

export type ResultadoLogin = { ok: true; usuarioId: string } | { ok: false; motivo: "credenciais" | "bloqueado"; liberaEm?: Date };

const normalizar = (email: string) => email.trim().toLowerCase();

export async function entrar(p: PortasLogin, entrada: { email: string; senha: string; ip: string | null }): Promise<ResultadoLogin> {
  const email = normalizar(entrada.email);
  const ip = entrada.ip;

  const antes = await p.bloqueadoAte(email);
  if (antes && antes > p.agora()) {
    await p.logSeguranca({ evento: "login_bloqueado", email, ip, detalhe: { libera_em: antes.toISOString(), tentativa_durante_bloqueio: true } });
    return { ok: false, motivo: "bloqueado", liberaEm: antes };
  }

  const r = await p.entrarComSenha(email, entrada.senha);
  await p.registrarTentativa(email, ip, r.ok);

  if (r.ok) {
    try {
      await p.logSeguranca({ evento: "login_ok", usuarioId: r.usuarioId, email, ip });
    } catch (e) {
      await p.sair(); // sem registro, o login não conclui
      throw e;
    }
    return { ok: true, usuarioId: r.usuarioId };
  }

  await p.logSeguranca({ evento: "login_falha", email, ip });
  const depois = await p.bloqueadoAte(email);
  if (depois && depois > p.agora()) {
    await p.logSeguranca({ evento: "login_bloqueado", email, ip, detalhe: { libera_em: depois.toISOString() } });
    return { ok: false, motivo: "bloqueado", liberaEm: depois };
  }
  return { ok: false, motivo: "credenciais" };
}

export function mensagemLogin(r: ResultadoLogin, fuso = "America/Sao_Paulo"): string {
  if (r.ok) return "";
  if (r.motivo === "bloqueado" && r.liberaEm) {
    const hora = r.liberaEm.toLocaleTimeString("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit" });
    return `Login bloqueado por 15 minutos depois de 3 senhas erradas. Tente de novo às ${hora}.`;
  }
  return "E-mail ou senha incorretos.";
}
