"use client";

import { EscolherLista, type ItemLista } from "@/components/escolher-lista";

/** Busca de empresa (nome ou CNPJ) que abre a escolhida e leva para `para` (padrão: o painel dela). */
export function EscolhaEmpresa({ empresas, para = "/painel", autoFoco }: { empresas: ItemLista[]; para?: string; autoFoco?: boolean }) {
  return (
    <EscolherLista itens={empresas} placeholder="Digite o nome ou o CNPJ da empresa" rotuloTodos={`${empresas.length} empresas ativas`} autoFoco={autoFoco}
      // navegação completa: a rota grava o cookie da empresa e redireciona
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      onEscolher={(x) => { window.location.href = `/api/empresa-atual?id=${x.id}&para=${encodeURIComponent(para)}`; }} />
  );
}
