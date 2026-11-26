"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { buscarServicos, buscarTomadores, type OpcaoCadastro } from "@/app/(app)/cadastros/actions";
import { ComboBusca } from "@/components/combo-busca";

/** Empresa escolhida no formulário da nota (o select fica no próprio formulário). */
function empresaDoFormulario(padrao?: string): string {
  const el = document.querySelector<HTMLSelectElement>('select[name="empresa_id"]');
  return el?.value || padrao || "";
}

function Busca({ rotulo, placeholder, buscar, param, inicial, empresaPadrao }: {
  rotulo: string;
  placeholder: string;
  buscar: (empresa: string, termo: string) => Promise<OpcaoCadastro[]>;
  param: "tomador" | "servico";
  inicial?: string;
  empresaPadrao?: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [texto, setTexto] = useState(inicial ?? "");
  const [opcoes, setOpcoes] = useState<OpcaoCadastro[]>([]);
  const ultimo = useRef(0);
  const [aviso, setAviso] = useState("");

  async function digitar(v: string) {
    setTexto(v);
    await carregar(v);
  }

  async function carregar(v: string) {
    const empresa = empresaDoFormulario(empresaPadrao);
    if (!empresa) { setAviso("Escolha primeiro a empresa."); return; }
    setAviso("");
    const n = ++ultimo.current;
    const r = await buscar(empresa, v);
    if (n === ultimo.current) setOpcoes(r);
  }

  function escolher(id: string) {
    const u = new URLSearchParams(sp.toString());
    u.set("empresa", empresaDoFormulario(empresaPadrao));
    u.set(param, id);
    router.push(`/notas/nova?${u.toString()}`);
  }

  return (
    <label>{rotulo}
      <ComboBusca texto={texto} placeholder={placeholder}
        opcoes={opcoes.map((o) => ({ valor: o.id, rotulo: o.rotulo }))}
        onDigitar={(v) => void digitar(v)}
        onAbrir={() => { if (opcoes.length === 0) void carregar(""); }}
        onEscolher={(o) => { ++ultimo.current; setTexto(o.rotulo); escolher(o.valor); }} />
      {aviso && <span className="suave">{aviso}</span>}
    </label>
  );
}

/**
 * Preenche a nota com um tomador e/ou um serviço salvos da empresa: a escolha recarrega a tela com os dados
 * do cadastro (os campos continuam editáveis antes de emitir).
 */
export function EscolherCadastro({ empresaPadrao, tomador, servico }: { empresaPadrao?: string; tomador?: string; servico?: string }) {
  return (
    <div className="grade">
      <Busca rotulo="Tomador salvo" placeholder="Digite o nome ou CPF/CNPJ (ou clique para ver a lista)" buscar={buscarTomadores} param="tomador" inicial={tomador} empresaPadrao={empresaPadrao} />
      <Busca rotulo="Serviço salvo" placeholder="Digite o nome ou a descrição do serviço" buscar={buscarServicos} param="servico" inicial={servico} empresaPadrao={empresaPadrao} />
    </div>
  );
}
