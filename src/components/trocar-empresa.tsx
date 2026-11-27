"use client";

/** Troca rápida da empresa aberta: caixa de seleção com todas as empresas ativas; escolher já abre o painel dela. */
export function TrocarEmpresa({ empresas, atual }: { empresas: { id: string; nome: string }[]; atual: string }) {
  return (
    <label className="trocar">
      <span className="suave">Trocar de empresa</span>
      <select value={atual} aria-label="Trocar de empresa"
        // navegação completa: a rota grava o cookie da empresa e redireciona
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        onChange={(e) => { window.location.href = `/api/empresa-atual?id=${e.target.value}&para=%2Fpainel`; }}>
        {empresas.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
      </select>
    </label>
  );
}
