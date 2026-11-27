"use client";

import { useEffect, useRef, useState } from "react";
import { CamposIbsCbsServico, type ValoresIbsCbsServico } from "@/components/campos-ibscbs-servico";
import { ComboBusca } from "@/components/combo-busca";
import { buscarCodigosTributacao, descricaoCodigo, nbsDoCodigo, type Opcao } from "@/app/(app)/notas/catalogo-actions";

const rotulo = (o: Opcao) => `${o.codigo} — ${o.descricao}`;

/**
 * Código de tributação nacional (busca pela descrição ou pelo código) e NBS (lista só as NBS aceitas para o
 * código escolhido, pela correlação item × NBS; com uma só, já vem marcada).
 */
export function CamposServico({ codigo, nbs, ibscbs }: { codigo?: string; nbs?: string; /** mostra os campos de IBS/CBS (cadastro do serviço) */ ibscbs?: ValoresIbsCbsServico }) {
  const [texto, setTexto] = useState(codigo ?? "");
  const [cod, setCod] = useState(codigo ?? "");
  const [opcoes, setOpcoes] = useState<Opcao[]>([]);
  const [nbsOpcoes, setNbsOpcoes] = useState<Opcao[]>([]);
  const [nbsEscolhida, setNbsEscolhida] = useState(nbs ?? "");
  const ultimo = useRef(0);

  useEffect(() => {
    if (!codigo) return;
    void descricaoCodigo("cod_tributacao_nacional", codigo).then((d) => { if (d) setTexto(rotulo({ codigo, descricao: d })); });
  }, [codigo]);

  // NBS correlacionadas: carregadas quando o código muda (pela digitação ou pelo valor inicial)
  const pedidoNbs = useRef(0);
  async function carregarNbs(c: string) {
    const n = ++pedidoNbs.current;
    const r = c ? await nbsDoCodigo(c) : [];
    if (n !== pedidoNbs.current) return;
    setNbsOpcoes(r);
    setNbsEscolhida((atual) => (r.some((o) => o.codigo === atual) ? atual : r.length === 1 ? r[0]!.codigo : ""));
  }
  useEffect(() => {
    if (codigo) void nbsDoCodigo(codigo).then((r) => { if (pedidoNbs.current === 0) setNbsOpcoes(r); });
  }, [codigo]);

  async function digitar(v: string) {
    setTexto(v);
    const m = v.match(/^(\d{6})\b/);
    const achado = opcoes.find((o) => rotulo(o) === v) ?? (m ? { codigo: m[1]!, descricao: "" } : undefined);
    const novo = achado?.codigo ?? "";
    if (novo !== cod) { setCod(novo); void carregarNbs(novo); }
    const n = ++ultimo.current;
    const r = await buscarCodigosTributacao(v.includes(" — ") ? v.split(" — ")[0]! : v);
    if (n === ultimo.current) setOpcoes(r);
  }

  return (
    <>
      <label className="largo">Código de tributação nacional
        <ComboBusca texto={texto} required invalido={Boolean(texto) && !cod}
          placeholder="Digite o código ou parte da descrição, ex.: contabilidade"
          opcoes={opcoes.map((o) => ({ valor: o.codigo, rotulo: rotulo(o) }))}
          onDigitar={(v) => void digitar(v)}
          onEscolher={(o) => { ++ultimo.current; setTexto(o.rotulo); if (o.valor !== cod) { setCod(o.valor); void carregarNbs(o.valor); } }} />
        <input type="hidden" name="codigo_tributacao_nacional" value={cod} />
        {texto && !cod && <span className="suave">Escolha um código da lista.</span>}
      </label>
      <label className="largo">NBS
        <select name="codigo_nbs" value={nbsEscolhida} onChange={(e) => setNbsEscolhida(e.target.value)} disabled={!cod}>
          <option value="">{!cod ? "Escolha primeiro o código de tributação" : nbsOpcoes.length === 0 ? "Nenhuma NBS correlacionada" : "Escolha…"}</option>
          {nbsOpcoes.map((o) => <option key={o.codigo} value={o.codigo}>{rotulo(o)}</option>)}
        </select>
      </label>
      {ibscbs && <CamposIbsCbsServico codigo={cod} nbs={nbsEscolhida} valores={ibscbs} />}
    </>
  );
}
