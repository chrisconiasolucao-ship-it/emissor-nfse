"use client";

import { useEffect, useRef, useState } from "react";
import { buscarDadosCnpj } from "@/app/(app)/cnpj/actions";
import type { PreenchimentoCnpj } from "@/lib/empresa/consulta-cnpj";
import { DEFINIR_MUNICIPIO } from "@/components/campo-municipio";

type Chave = Exclude<keyof PreenchimentoCnpj, "aviso">;

/**
 * Campo de CPF/CNPJ que, ao completar um CNPJ, busca os dados públicos (BrasilAPI) e preenche os outros campos do
 * mesmo formulário. `campos` liga cada dado ao `name` do campo. Só preenche campo vazio (ou ainda com o valor da
 * busca anterior), para não apagar o que o usuário digitou; o botão "Buscar de novo" substitui tudo. Se a consulta
 * falhar ou demorar, o cadastro segue à mão.
 */
export function CampoCnpj({ name, defaultValue, required, campos, tipo, municipio, buscarAoAbrir }: {
  name: string;
  defaultValue?: string;
  required?: boolean;
  campos: Partial<Record<Chave, string>>;
  /** name do select CPF/CNPJ, ajustado sozinho pelo tamanho do número */
  tipo?: string;
  /** name do campo escondido do município (CampoMunicipio) */
  municipio?: string;
  /** já abre buscando, quando o CNPJ veio digitado de outra tela */
  buscarAoAbrir?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const preenchido = useRef<Record<string, string>>({});
  const ultimo = useRef(0);
  const [cnpj, setCnpj] = useState("");
  const [estado, setEstado] = useState<{ tipo: "carregando" | "ok" | "erro"; texto: string } | null>(null);

  function campo(nome: string) {
    const f = ref.current?.form?.elements.namedItem(nome);
    return f instanceof HTMLInputElement || f instanceof HTMLSelectElement || f instanceof HTMLTextAreaElement ? f : null;
  }

  async function buscar(c: string, substituir: boolean) {
    const n = ++ultimo.current;
    setEstado({ tipo: "carregando", texto: "Buscando os dados do CNPJ na Receita…" });
    const r = await buscarDadosCnpj(c);
    if (n !== ultimo.current) return;
    if ("erro" in r) { setEstado({ tipo: "erro", texto: `${r.erro} Você pode preencher à mão.` }); return; }
    const d = r.dados;
    const anterior = preenchido.current;
    const agora: Record<string, string> = {};
    for (const [chave, nome] of Object.entries(campos) as [Chave, string][]) {
      const valor = d[chave];
      if (!valor) continue;
      if (nome === municipio) {
        const oculto = campo(nome);
        if (oculto && (substituir || !oculto.value || oculto.value === anterior[nome])) {
          oculto.dispatchEvent(new CustomEvent(DEFINIR_MUNICIPIO, { detail: valor }));
          agora[nome] = valor;
        }
        continue;
      }
      const el = campo(nome);
      if (!el) continue;
      if (substituir || el instanceof HTMLSelectElement || !el.value.trim() || el.value === anterior[nome]) { el.value = valor; agora[nome] = valor; }
    }
    preenchido.current = { ...anterior, ...agora };
    const extra = !campos.nome_fantasia && d.nome_fantasia ? ` Nome fantasia: ${d.nome_fantasia}.` : "";
    setEstado({ tipo: d.aviso ? "erro" : "ok", texto: `${d.aviso ? d.aviso + " " : ""}Dados preenchidos pela consulta do CNPJ. Confira antes de salvar.${extra}` });
  }

  function digitar(v: string) {
    const num = v.replace(/\D/g, "");
    const sel = tipo ? campo(tipo) : null;
    if (sel && (num.length === 11 || num.length === 14)) sel.value = num.length === 14 ? "CNPJ" : "CPF";
    if (num.length === 14 && num !== cnpj) { setCnpj(num); void buscar(num, false); }
    else if (num.length !== 14) { setCnpj(""); ++ultimo.current; setEstado(null); }
  }

  useEffect(() => {
    if (buscarAoAbrir && ref.current) digitar(ref.current.value);
    // só ao abrir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <input ref={ref} name={name} defaultValue={defaultValue} required={required} inputMode="numeric" autoComplete="off" placeholder="Com CNPJ, os dados vêm sozinhos"
        onChange={(e) => digitar(e.target.value)} />
      {estado && <span className={estado.tipo === "erro" ? "aviso-campo" : "suave"} role="status">
        {estado.tipo === "carregando" && <span className="giro" aria-hidden />}{estado.texto}
      </span>}
      {cnpj && estado?.tipo !== "carregando" && (
        <button type="button" className="link" onClick={() => void buscar(cnpj, true)}>Buscar de novo e substituir os dados</button>
      )}
    </>
  );
}
