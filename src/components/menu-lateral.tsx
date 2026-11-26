"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type ItemMenu = { href: string; rotulo: string };

/** Itens do menu lateral; marca o item da tela atual (a Nova nota não acende "Notas"). */
export function ItensMenu({ itens }: { itens: ItemMenu[] }) {
  const atual = usePathname();
  const ativo = itens
    .filter((i) => atual === i.href || atual.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="Menu principal">
      {itens.map((i) => (
        <Link key={i.href} href={i.href} aria-current={i.href === ativo ? "page" : undefined}>{i.rotulo}</Link>
      ))}
    </nav>
  );
}
