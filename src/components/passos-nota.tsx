"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { buscarServicos, buscarTomadores } from "@/app/(app)/cadastros/actions";
import { EscolherLista, type ItemLista } from "@/components/escolher-lista";

export type Escolhido = { titulo: string; detalhe?: string; codigo?: string; origem?: string; novo?: boolean } | null;

const ORIGEM: Record<string, string> = { adn: "ADN", xml: "XML", manual: "manual", nota: "nota", planilha: "planilha" };

function Escolhido({ e, onTrocar, rotuloTrocar = "Trocar" }: { e: NonNullable<Escolhido>; onTrocar?: () => void; rotuloTrocar?: string }) {
  return (
    <div className="escolhido">
      <div>
        <strong>{e.codigo && <span className="codigo">{e.codigo}</span>}{e.titulo}</strong>
        {(e.detalhe || e.origem) && <span className="suave">{e.detalhe}{e.origem && <> · <span className={`etiqueta ${e.origem}`}>{ORIGEM[e.origem] ?? e.origem}</span></>}</span>}
      </div>
      {onTrocar && <button type="button" className="secundario mini" onClick={onTrocar}>{rotuloTrocar}</button>}
    </div>
  );
}

function Passo({ n, titulo, bloqueado, children }: { n: number; titulo: string; bloqueado?: string; children?: React.ReactNode }) {
  return (
    <section className={`cartao passo${bloqueado ? " bloqueado" : ""}`} aria-labelledby={`passo-${n}`}>
      <div className="cartao-cab"><h2 className="passo-titulo" id={`passo-${n}`} style={{ margin: 0 }}><span className="passo-num">{n}</span>{titulo}</h2></div>
      {bloqueado ? <p className="suave" style={{ margin: 0 }}>{bloqueado}</p> : children}
    </section>
  );
}

/**
 * Os três passos da nova nota: empresa → tomador → serviço. Cada escolha vai para a URL e a tela recarrega
 * com os dados do cadastro no formulário (que continua editável antes de emitir).
 */
export function PassosNota({ empresas, empresaId, empresa, tomador, servico, trocarEmpresa, travado }: {
  empresas: ItemLista[];
  empresaId?: string;
  empresa: Escolhido;
  tomador: Escolhido;
  servico: Escolhido;
  /** Escritório escolhe entre várias empresas; o cliente tem a dele fixa. */
  trocarEmpresa: boolean;
  /** Rascunho, modelo, XML ou substituição: os dados já vêm da nota de origem. */
  travado?: boolean;
}) {
  const router = useRouter();
  const caminho = usePathname();
  const sp = useSearchParams();

  const ir = useCallback((muda: Record<string, string | null>) => {
    const u = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(muda)) { if (v === null) u.delete(k); else u.set(k, v); }
    router.push(`${caminho}?${u.toString()}`, { scroll: false });
  }, [router, caminho, sp]);

  const buscaTomador = useCallback(async (t: string): Promise<ItemLista[]> => {
    if (!empresaId) return [];
    return (await buscarTomadores(empresaId, t)).map((o) => ({ id: o.id, titulo: o.titulo ?? o.rotulo, detalhe: o.detalhe, origem: o.origem }));
  }, [empresaId]);
  const buscaServico = useCallback(async (t: string): Promise<ItemLista[]> => {
    if (!empresaId) return [];
    return (await buscarServicos(empresaId, t)).map((o) => ({ id: o.id, titulo: o.titulo ?? o.rotulo, detalhe: o.detalhe, codigo: o.codigo, origem: o.origem }));
  }, [empresaId]);

  const semEmpresa = "Escolha a empresa primeiro. Os cadastros aparecem conforme a empresa.";
  const limpa = { tomador: null, servico: null, tdoc: null, tnome: null, scod: null, sdesc: null };

  return (
    <>
      <Passo n={1} titulo="Empresa (prestador)">
        {empresa
          ? <Escolhido e={empresa} onTrocar={trocarEmpresa && !travado ? () => ir({ empresa: null, ...limpa }) : undefined} />
          : <EscolherLista itens={empresas} placeholder="Digite o nome ou o CNPJ da empresa" rotuloTodos={`Todas as ${empresas.length} empresas ativas`}
              onEscolher={(x) => ir({ empresa: x.id, ...limpa })} autoFoco />}
      </Passo>

      <Passo n={2} titulo="Tomador" bloqueado={empresaId ? undefined : semEmpresa}>
        {tomador
          ? <Escolhido e={tomador} onTrocar={travado ? undefined : () => ir({ tomador: null, tdoc: null, tnome: null })} />
          : <EscolherLista key={`t-${empresaId}`} buscar={buscaTomador} placeholder="Digite o nome ou o CPF/CNPJ do tomador" rotuloTodos="Tomadores desta empresa"
              rotuloNovo="Cadastrar novo tomador" autoFoco
              onEscolher={(x) => ir({ tomador: x.id, tdoc: null, tnome: null })}
              onNovo={(t) => ir({ tomador: "novo", tdoc: /^[\d.\-/\s]+$/.test(t) && t ? t.replace(/\D/g, "") : null, tnome: /^[\d.\-/\s]+$/.test(t) ? null : t || null })} />}
      </Passo>

      <Passo n={3} titulo="Serviço" bloqueado={empresaId ? undefined : semEmpresa}>
        {servico
          ? <Escolhido e={servico} onTrocar={travado ? undefined : () => ir({ servico: null, scod: null, sdesc: null })} />
          : <EscolherLista key={`s-${empresaId}`} buscar={buscaServico} placeholder="Digite o código (ex.: 01.07) ou o nome do serviço" rotuloTodos="Serviços desta empresa"
              rotuloNovo="Cadastrar novo serviço" autoFoco={Boolean(tomador)}
              onEscolher={(x) => ir({ servico: x.id, scod: null, sdesc: null })}
              onNovo={(t) => ir({ servico: "novo", scod: /^[\d.\s]+$/.test(t) && t ? t.replace(/\D/g, "") : null, sdesc: /^[\d.\s]+$/.test(t) ? null : t || null })} />}
      </Passo>
    </>
  );
}
