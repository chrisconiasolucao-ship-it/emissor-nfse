"use client";

import { useActionState } from "react";
import type { Estado } from "@/app/(app)/notas/actions";

/** Formulário com Server Action e retorno de mensagem (erro, sucesso, confirmação de duplicidade). */
export function Formulario({
  acao,
  children,
  className,
  botao,
}: {
  acao: (e: Estado, f: FormData) => Promise<Estado>;
  children: React.ReactNode;
  className?: string;
  botao?: React.ReactNode;
}) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  return (
    <form action={enviar} className={className}>
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
