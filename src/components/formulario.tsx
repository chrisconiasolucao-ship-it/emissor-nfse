"use client";

import { useActionState, useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { Estado } from "@/app/(app)/notas/actions";

const semInscricao = () => () => {};

/** Formulário com Server Action e retorno de mensagem (erro, sucesso, confirmação de duplicidade). */
export function Formulario({
  acao,
  children,
  className,
  botao,
  aoConcluir,
  id,
  lateral,
  lateralEm,
}: {
  acao: (e: Estado, f: FormData) => Promise<Estado>;
  children: React.ReactNode;
  className?: string;
  botao?: React.ReactNode;
  /** Para onde ir quando a ação der certo (ex.: fechar a janela de cadastro e voltar à lista). */
  aoConcluir?: string;
  /** id do form, para botões de fora (atributo form) enviarem por ele. */
  id?: string;
  /** Botões repetidos noutro lugar da tela (ex.: no Resumo), levados para o elemento lateralEm; ficam desativados enquanto envia. */
  lateral?: React.ReactNode;
  lateralEm?: string;
}) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const router = useRouter();
  useEffect(() => { if (estado.ok && aoConcluir) { router.replace(aoConcluir, { scroll: false }); router.refresh(); } }, [estado, aoConcluir, router]);
  // o elemento de destino só existe no navegador; no servidor fica null e os botões laterais aparecem após hidratar
  const alvo = useSyncExternalStore(semInscricao, () => (lateralEm ? document.getElementById(lateralEm) : null), () => null);
  return (
    <form action={enviar} className={className} id={id}>
      {alvo && lateral && createPortal(
        <fieldset className="botoes-lateral" disabled={pendente}>
          {lateral}
          {pendente && <span className="suave carregando">Enviando…</span>}
          {(estado.erro || estado.confirmar || (estado.erros?.length ?? 0) > 0) && !pendente && <span className="msg erro">Veja o aviso no fim do formulário.</span>}
        </fieldset>,
        alvo,
      )}
      {children}
      {estado.confirmar && (
        <div className="msg alerta largo">
          {estado.confirmar}
          <input type="hidden" name="confirmar_duplicidade" value="sim" />
          <input type="hidden" name="id" value={estado.mensagem ?? ""} />
          <div className="acoes" style={{ marginTop: 8 }}>
            <button type="submit" name="acao" value="emitir">Sim, emitir mesmo assim</button>
          </div>
        </div>
      )}
      {estado.erro && <div className="msg erro largo">{estado.erro}</div>}
      {estado.erros && estado.erros.length > 0 && (
        <ul className="msg erro largo">
          {estado.erros.slice(0, 30).map((e, i) => (
            <li key={i}>Linha {e.linha}, {e.campo}: {e.mensagem}</li>
          ))}
        </ul>
      )}
      {estado.ok && estado.mensagem && <div className="msg ok largo">{estado.mensagem}</div>}
      <div className="acoes largo">{botao ?? <button type="submit" disabled={pendente}>{pendente ? "Enviando…" : "Enviar"}</button>}</div>
    </form>
  );
}
