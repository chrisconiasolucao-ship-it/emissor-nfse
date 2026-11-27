"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

type Empresa = { id: string; nome: string; cnpj: string; detalhe: string };

const semAcento = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Troca rápida da empresa aberta: caixa com busca por nome ou CNPJ e a lista de todas as empresas ativas.
 * Escolher (clique ou ↑ ↓ Enter) já abre o painel da empresa.
 */
export function TrocarEmpresa({ empresas, atual }: { empresas: Empresa[]; atual: string }) {
  const id = useId();
  const [aberta, setAberta] = useState(false);
  const [termo, setTermo] = useState("");
  const [ativo, setAtivo] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);

  const achadas = useMemo(() => {
    const q = semAcento(termo.trim());
    const dig = termo.replace(/\D/g, "");
    if (!q) return empresas;
    return empresas.filter((e) => semAcento(e.nome).includes(q) || (dig.length > 0 && e.cnpj.includes(dig)));
  }, [empresas, termo]);

  useEffect(() => {
    if (!aberta) return;
    const fora = (ev: MouseEvent) => { if (!caixa.current?.contains(ev.target as Node)) setAberta(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberta]);
  useEffect(() => { lista.current?.querySelector<HTMLElement>('[data-ativo="true"]')?.scrollIntoView({ block: "nearest" }); }, [ativo]);

  function abrir(e: Empresa) {
    if (e.id === atual) { setAberta(false); return; }
    // navegação completa: a rota grava o cookie da empresa e redireciona
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/api/empresa-atual?id=${e.id}&para=%2Fpainel`;
  }
  function tecla(ev: React.KeyboardEvent<HTMLInputElement>) {
    if (ev.key === "ArrowDown") { ev.preventDefault(); setAberta(true); setAtivo((i) => Math.min(i + 1, achadas.length - 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)); }
    else if (ev.key === "Enter") { ev.preventDefault(); if (achadas[ativo]) abrir(achadas[ativo]!); }
    else if (ev.key === "Escape") { setAberta(false); setTermo(""); }
  }

  return (
    <div className="trocar" ref={caixa}>
      <label htmlFor={`${id}-busca`} className="suave">Trocar de empresa</label>
      <input id={`${id}-busca`} className="trocar-busca" value={termo} placeholder="Buscar por nome ou CNPJ" autoComplete="off"
        role="combobox" aria-expanded={aberta} aria-controls={`${id}-lista`} aria-autocomplete="list"
        onFocus={() => setAberta(true)} onChange={(e) => { setTermo(e.target.value); setAtivo(0); setAberta(true); }} onKeyDown={tecla} />
      {aberta && (
        <div className="trocar-lista" id={`${id}-lista`} role="listbox" ref={lista}>
          <div className="trocar-rot">{termo.trim() ? `${achadas.length} encontrada(s)` : `${empresas.length} empresas ativas`}</div>
          {achadas.map((e, i) => (
            <button type="button" key={e.id} role="option" aria-selected={i === ativo} data-ativo={i === ativo}
              className={e.id === atual ? "atual" : undefined} onMouseEnter={() => setAtivo(i)} onClick={() => abrir(e)}>
              <b>{e.nome}</b><small>{e.detalhe}{e.id === atual ? " · aberta" : ""}</small>
            </button>
          ))}
          {achadas.length === 0 && <div className="trocar-rot">Nenhuma empresa com “{termo.trim()}”.</div>}
        </div>
      )}
    </div>
  );
}
