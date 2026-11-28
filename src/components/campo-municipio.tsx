"use client";

import { useEffect, useRef, useState } from "react";
import { buscarMunicipios, type OpcaoMunicipio } from "@/app/(app)/municipios/actions";
import { ComboBusca } from "@/components/combo-busca";

/** Evento para outro campo (ex.: busca do CNPJ) definir o município pelo código IBGE: detail = código. */
export const DEFINIR_MUNICIPIO = "municipio:definir";

const rotulo = (m: OpcaoMunicipio) => `${m.nome}/${m.uf}`;
const normal = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();

/**
 * Município pelo nome (ex.: "Bagé/RS"); o código IBGE vai num campo escondido com o `name` informado.
 * Lista vem da situação dos municípios importada da Receita. Clicar na lista escolhe; digitar o nome exato também
 * vale quando só um município tem esse nome.
 */
export function CampoMunicipio({ name, codigo, required }: { name: string; codigo?: string | null; required?: boolean }) {
  const [texto, setTexto] = useState("");
  const [cod, setCod] = useState(codigo ?? "");
  const [opcoes, setOpcoes] = useState<OpcaoMunicipio[]>([]);
  const ultimo = useRef(0);
  const oculto = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = oculto.current;
    if (!el) return;
    const definir = (ev: Event) => {
      const c = String((ev as CustomEvent<string>).detail ?? "");
      if (!/^\d{7}$/.test(c)) return;
      const n = ++ultimo.current;
      setCod(c);
      setTexto(c);
      void buscarMunicipios(c).then((r) => { if (n === ultimo.current && r[0]) setTexto(rotulo(r[0])); });
    };
    el.addEventListener(DEFINIR_MUNICIPIO, definir);
    return () => el.removeEventListener(DEFINIR_MUNICIPIO, definir);
  }, []);

  // valor inicial: mostra o nome do código já gravado
  useEffect(() => {
    if (!codigo) return;
    let vivo = true;
    void buscarMunicipios(codigo).then((r) => { if (vivo && r[0]) setTexto(rotulo(r[0])); else if (vivo) setTexto(codigo); });
    return () => { vivo = false; };
  }, [codigo]);

  async function digitar(v: string) {
    setTexto(v);
    const alvo = normal(v);
    const casa = (m: OpcaoMunicipio) => normal(rotulo(m)) === alvo;
    const achado = opcoes.find(casa);
    setCod(achado ? achado.cod : /^\d{7}$/.test(v.trim()) ? v.trim() : "");
    const n = ++ultimo.current;
    const r = await buscarMunicipios(v);
    if (n !== ultimo.current) return;
    setOpcoes(r);
    const mesmoNome = r.filter((m) => normal(m.nome) === alvo);
    const exato = r.find(casa) ?? (mesmoNome.length === 1 ? mesmoNome[0] : undefined);
    if (exato) setCod(exato.cod);
  }

  return (
    <>
      <ComboBusca texto={texto} placeholder="Digite o nome, ex.: Bagé/RS" required={required} invalido={Boolean(texto) && !cod}
        opcoes={opcoes.map((m) => ({ valor: m.cod, rotulo: rotulo(m) }))}
        onDigitar={(v) => void digitar(v)}
        onEscolher={(o) => { ++ultimo.current; setTexto(o.rotulo); setCod(o.valor); }} />
      <input ref={oculto} type="hidden" name={name} value={cod} />
      {texto && !cod && <span className="suave">Escolha um município da lista.</span>}
    </>
  );
}
