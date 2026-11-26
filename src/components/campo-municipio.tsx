"use client";

import { useEffect, useId, useRef, useState } from "react";
import { buscarMunicipios, type OpcaoMunicipio } from "@/app/(app)/municipios/actions";

const rotulo = (m: OpcaoMunicipio) => `${m.nome}/${m.uf}`;

/**
 * Município pelo nome (ex.: "Bagé/RS"); o código IBGE vai num campo escondido com o `name` informado.
 * Lista vem da situação dos municípios importada da Receita.
 */
export function CampoMunicipio({ name, codigo, required }: { name: string; codigo?: string | null; required?: boolean }) {
  const lista = useId();
  const [texto, setTexto] = useState("");
  const [cod, setCod] = useState(codigo ?? "");
  const [opcoes, setOpcoes] = useState<OpcaoMunicipio[]>([]);
  const ultimo = useRef(0);

  // valor inicial: mostra o nome do código já gravado
  useEffect(() => {
    if (!codigo) return;
    let vivo = true;
    void buscarMunicipios(codigo).then((r) => { if (vivo && r[0]) setTexto(rotulo(r[0])); else if (vivo) setTexto(codigo); });
    return () => { vivo = false; };
  }, [codigo]);

  async function digitar(v: string) {
    setTexto(v);
    const achado = opcoes.find((m) => rotulo(m).toLowerCase() === v.trim().toLowerCase());
    setCod(achado ? achado.cod : /^\d{7}$/.test(v.trim()) ? v.trim() : "");
    const n = ++ultimo.current;
    const r = await buscarMunicipios(v);
    if (n !== ultimo.current) return;
    setOpcoes(r);
    const exato = r.find((m) => rotulo(m).toLowerCase() === v.trim().toLowerCase()) ?? (r.length === 1 && v.includes("/") ? r[0] : undefined);
    if (exato) setCod(exato.cod);
  }

  return (
    <>
      <input list={lista} value={texto} onChange={(e) => void digitar(e.target.value)} placeholder="Digite o nome, ex.: Bagé/RS"
        required={required} autoComplete="off" aria-invalid={Boolean(texto) && !cod} />
      <datalist id={lista}>{opcoes.map((m) => <option key={m.cod} value={rotulo(m)} />)}</datalist>
      <input type="hidden" name={name} value={cod} />
      {texto && !cod && <span className="suave">Escolha um município da lista.</span>}
    </>
  );
}
