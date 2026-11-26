"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type ItemLista = { id: string; titulo: string; detalhe?: string; codigo?: string; direita?: string; origem?: string };

const ORIGEM: Record<string, string> = { adn: "ADN", xml: "XML", manual: "manual", nota: "nota", planilha: "planilha" };

const semAcento = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Destaca o trecho buscado: por texto (sem acento) ou, quando a busca é só de dígitos, pelos dígitos. */
function Destaque({ texto, busca }: { texto: string; busca: string }) {
  const q = busca.trim();
  if (!q) return <>{texto}</>;
  const dig = q.replace(/\D/g, "");
  if (dig && /^[\d.\-/\s]+$/.test(q)) {
    const pos: number[] = [];
    let so = "";
    for (let i = 0; i < texto.length; i++) if (/\d/.test(texto[i]!)) { pos.push(i); so += texto[i]; }
    const k = so.indexOf(dig);
    if (k < 0) return <>{texto}</>;
    const a = pos[k]!, b = pos[k + dig.length - 1]! + 1;
    return <>{texto.slice(0, a)}<mark>{texto.slice(a, b)}</mark>{texto.slice(b)}</>;
  }
  const i = semAcento(texto).indexOf(semAcento(q));
  if (i < 0) return <>{texto}</>;
  return <>{texto.slice(0, i)}<mark>{texto.slice(i, i + q.length)}</mark>{texto.slice(i + q.length)}</>;
}

/**
 * Lista sempre visível com busca: clicar numa linha ou usar ↑ ↓ Enter escolhe. A última linha é sempre
 * "Cadastrar novo", levando o que foi digitado. A busca pode ser local (itens) ou no servidor (buscar).
 */
export function EscolherLista({ itens, buscar, placeholder, rotuloTodos, rotuloNovo, onEscolher, onNovo, autoFoco }: {
  itens?: ItemLista[];
  buscar?: (termo: string) => Promise<ItemLista[]>;
  placeholder: string;
  rotuloTodos: string;
  rotuloNovo?: string;
  onEscolher: (item: ItemLista) => void;
  onNovo?: (termo: string) => void;
  autoFoco?: boolean;
}) {
  const id = useId();
  const [termo, setTermo] = useState("");
  const [remotos, setRemotos] = useState<ItemLista[] | null>(null);
  const [ativo, setAtivo] = useState(0);
  const ultimo = useRef(0);
  const lista = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!buscar) return;
    const n = ++ultimo.current;
    const t = setTimeout(() => { void buscar(termo).then((r) => { if (n === ultimo.current) setRemotos(r); }); }, termo ? 180 : 0);
    return () => clearTimeout(t);
  }, [buscar, termo]);

  const achados = useMemo(() => {
    if (buscar) return remotos ?? [];
    const q = semAcento(termo.trim());
    const dig = termo.replace(/\D/g, "");
    if (!q) return itens ?? [];
    return (itens ?? []).filter((x) => semAcento(x.titulo).includes(q) || (dig.length > 0 && (x.detalhe ?? "").replace(/\D/g, "").includes(dig)));
  }, [buscar, remotos, itens, termo]);

  const total = achados.length + (onNovo ? 1 : 0);
  function tecla(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setAtivo((i) => Math.min(i + 1, total - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (ativo < achados.length) onEscolher(achados[ativo]!);
      else onNovo?.(termo.trim());
    }
  }
  useEffect(() => { lista.current?.querySelector<HTMLElement>('[data-ativo="true"]')?.scrollIntoView({ block: "nearest" }); }, [ativo]);

  const carregando = buscar && remotos === null;
  return (
    <div className="escolha">
      <input className="escolha-busca" value={termo} placeholder={placeholder} autoComplete="off" autoFocus={autoFoco}
        role="combobox" aria-expanded="true" aria-controls={id} aria-autocomplete="list"
        onChange={(e) => { setTermo(e.target.value); setAtivo(0); }} onKeyDown={tecla} />
      <div className="escolha-lista" id={id} role="listbox" ref={lista}>
        <div className="escolha-rot" aria-live="polite">
          {carregando ? "Carregando…" : termo.trim() ? `${achados.length} encontrado(s) para “${termo.trim()}”` : rotuloTodos}
        </div>
        {achados.map((x, i) => (
          <button type="button" key={x.id} role="option" aria-selected={i === ativo} data-ativo={i === ativo}
            className="escolha-item" onClick={() => onEscolher(x)} onMouseEnter={() => setAtivo(i)}>
            <strong>{x.codigo && <span className="codigo"><Destaque texto={x.codigo} busca={/^[\d.\s]+$/.test(termo) ? termo : ""} /></span>}<Destaque texto={x.titulo} busca={/^[\d.\-/\s]+$/.test(termo) ? "" : termo} /></strong>
            {x.detalhe && <span className="suave"><Destaque texto={x.detalhe} busca={x.codigo ? "" : termo} /></span>}
            {(x.origem || x.direita) && (
              <span className="dir">
                {x.origem && <span className={`etiqueta ${x.origem}`}>{ORIGEM[x.origem] ?? x.origem}</span>}
                {x.direita && <><br />{x.direita}</>}
              </span>
            )}
          </button>
        ))}
        {!carregando && achados.length === 0 && termo.trim() && <div className="escolha-item" style={{ cursor: "default" }}><span className="suave">Nada encontrado. Confira a digitação ou cadastre abaixo.</span></div>}
        {onNovo && (
          <button type="button" role="option" aria-selected={ativo === achados.length} data-ativo={ativo === achados.length}
            className="escolha-item novo" onClick={() => onNovo(termo.trim())} onMouseEnter={() => setAtivo(achados.length)}>
            + {rotuloNovo}{termo.trim() ? ` com “${termo.trim()}”` : ""}
          </button>
        )}
      </div>
    </div>
  );
}
