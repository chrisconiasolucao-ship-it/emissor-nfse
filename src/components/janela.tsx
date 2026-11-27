"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Janela sobre a tela (cadastro de tomador ou serviço). Abre pela URL (?novo=1 ou ?editar=id), então o
 * link pode ser guardado e o voltar do navegador fecha. Esc ou clique fora também fecham.
 */
export function Janela({ titulo, fechar, children }: { titulo: string; fechar: string; children: React.ReactNode }) {
  const router = useRouter();
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") router.replace(fechar, { scroll: false }); };
    document.addEventListener("keydown", tecla);
    caixa.current?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea")?.focus();
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", tecla); document.body.style.overflow = ""; };
  }, [fechar, router]);
  return (
    <div className="janela-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) router.replace(fechar, { scroll: false }); }}>
      <div className="janela" role="dialog" aria-modal="true" aria-labelledby="janela-titulo" ref={caixa}>
        <div className="janela-cab">
          <h2 id="janela-titulo">{titulo}</h2>
          <Link href={fechar} replace scroll={false} className="janela-x" aria-label="Fechar">×</Link>
        </div>
        {children}
      </div>
    </div>
  );
}
