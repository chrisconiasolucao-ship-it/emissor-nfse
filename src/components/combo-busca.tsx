"use client";

import { useId, useState } from "react";

export type OpcaoCombo = { valor: string; rotulo: string };

/**
 * Caixa de busca com lista própria (sem <datalist>): clicar numa opção ou usar ↑ ↓ Enter escolhe.
 * Quem usa cuida da busca (onDigitar) e do que fazer com a escolha (onEscolher).
 */
export function ComboBusca({ texto, opcoes, onDigitar, onEscolher, placeholder, required, invalido }: {
  texto: string;
  opcoes: OpcaoCombo[];
  onDigitar: (v: string) => void;
  onEscolher: (o: OpcaoCombo) => void;
  placeholder?: string;
  required?: boolean;
  invalido?: boolean;
}) {
  const id = useId();
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const mostrar = aberto && opcoes.length > 0;

  function escolher(o: OpcaoCombo) {
    onEscolher(o);
    setAberto(false);
  }

  function tecla(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setAberto(true); setAtivo((i) => Math.min(i + 1, opcoes.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && mostrar) { e.preventDefault(); const o = opcoes[ativo]; if (o) escolher(o); }
    else if (e.key === "Escape") setAberto(false);
  }

  return (
    <span className="combo">
      <input value={texto} placeholder={placeholder} required={required} autoComplete="off" aria-invalid={invalido}
        role="combobox" aria-expanded={mostrar} aria-controls={id} aria-autocomplete="list"
        onChange={(e) => { onDigitar(e.target.value); setAberto(true); setAtivo(0); }}
        onFocus={() => setAberto(true)} onBlur={() => setAberto(false)} onKeyDown={tecla} />
      {mostrar && (
        <ul id={id} role="listbox" className="combo-lista">
          {opcoes.map((o, i) => (
            <li key={o.valor} role="option" aria-selected={i === ativo} className={i === ativo ? "ativo" : undefined}
              onMouseDown={(e) => { e.preventDefault(); escolher(o); }} onMouseEnter={() => setAtivo(i)}>
              {o.rotulo}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
