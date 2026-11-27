"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** `simples`: link comum (sem prefetch), para rotas que gravam cookie, como a que fecha a empresa aberta. */
export type ItemMenu = { href: string; rotulo: string; simples?: boolean };
export type GrupoMenu = { titulo?: string; itens: ItemMenu[] };

/** Itens do menu lateral em grupos; marca o item da tela atual (a Nova nota não acende "Notas"). */
export function ItensMenu({ grupos }: { grupos: GrupoMenu[] }) {
  const atual = usePathname();
  const ativo = grupos.flatMap((g) => g.itens)
    .filter((i) => atual === i.href || atual.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="Menu principal">
      {grupos.map((g, k) => (
        <div key={k} className="menu-grupo">
          {g.titulo && <span className="menu-titulo">{g.titulo}</span>}
          {g.itens.map((i) => i.simples
            ? <a key={i.href} href={i.href}>{i.rotulo}</a>
            : <Link key={i.href} href={i.href} aria-current={i.href === ativo ? "page" : undefined}>{i.rotulo}</Link>)}
        </div>
      ))}
    </nav>
  );
}
