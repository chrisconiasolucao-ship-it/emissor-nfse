"use client";

import { useEffect, useRef, useState } from "react";
import { opcoesIbsCbs, type OpcoesIbsCbs, type Opcao } from "@/app/(app)/notas/catalogo-actions";
import { sugerirIbsCbs } from "@/lib/nfse/ibscbs-sugestao";

const rotulo = (o: Opcao) => `${o.codigo} — ${o.descricao.length > 110 ? `${o.descricao.slice(0, 110)}…` : o.descricao}`;

export type ValoresIbsCbsServico = { cclasstrib?: string | null; cindOp?: string | null; cativSn?: string | null };

/**
 * IBS/CBS do serviço (NT 009): classificação (cClassTrib), indicador da operação (cIndOp) e atividade do Simples (cAtvSN).
 * As listas seguem a correlação oficial do código + NBS; vazio = o sistema usa a correlação quando ela tem uma opção só.
 */
export function CamposIbsCbsServico({ codigo, nbs, valores }: { codigo: string; nbs: string; valores?: ValoresIbsCbsServico }) {
  const [op, setOp] = useState<OpcoesIbsCbs | null>(null);
  const [cc, setCc] = useState(valores?.cclasstrib?.trim() ?? "");
  const [io, setIo] = useState(valores?.cindOp?.trim() ?? "");
  const pedido = useRef(0);

  useEffect(() => {
    const n = ++pedido.current;
    void opcoesIbsCbs(codigo, nbs).then((r) => { if (n === pedido.current) setOp(r); });
  }, [codigo, nbs]);

  const corr = op?.correlacao ?? [];
  const sug = sugerirIbsCbs(corr);
  const ccPermitidos = corr.length ? new Set(corr.map((c) => c.cClassTrib)) : null;
  const ccOpcoes = (op?.cclasstrib ?? []).filter((o) => !ccPermitidos || ccPermitidos.has(o.codigo) || o.codigo === cc);
  const ccEfetivo = cc || sug.cClassTrib || "";
  const ioPermitidos = corr.length ? new Set(corr.filter((c) => !ccEfetivo || c.cClassTrib === ccEfetivo).map((c) => c.indOp)) : null;
  const ioOpcoes = (op?.indop ?? []).filter((o) => !ioPermitidos || ioPermitidos.has(o.codigo) || o.codigo === io);
  const nomeCc = (c: string | null) => (c ? (op?.cclasstrib.find((o) => o.codigo === c)?.descricao ?? "") : "");

  return (
    <fieldset className="largo">
      <legend>IBS e CBS (a partir de 2027)</legend>
      <p className="suave">
        {corr.length
          ? `A tabela oficial da Receita tem ${new Set(corr.map((c) => c.cClassTrib)).size} classificação(ões) para este código e NBS.`
          : nbs
            ? "Esta NBS não tem correlação oficial: escolha a classificação e o indicador."
            : "Escolha a NBS para o sistema sugerir a classificação."}
        {" "}Só vai na nota quando a Receita liberar os campos.
      </p>
      <label className="largo">Classificação tributária (cClassTrib)
        <select name="cclasstrib" value={cc} onChange={(e) => setCc(e.target.value)}>
          <option value="">{sug.cClassTrib ? `Automático: ${sug.cClassTrib} — ${nomeCc(sug.cClassTrib)}` : "Escolha…"}</option>
          {ccOpcoes.map((o) => <option key={o.codigo} value={o.codigo}>{rotulo(o)}</option>)}
        </select>
      </label>
      <label className="largo">Indicador da operação (cIndOp)
        <select name="cind_op" value={io} onChange={(e) => setIo(e.target.value)}>
          <option value="">{!cc && sug.cIndOp ? `Automático: ${sug.cIndOp}` : ioPermitidos?.size === 1 ? `Automático: ${[...ioPermitidos][0]}` : "Escolha…"}</option>
          {ioOpcoes.map((o) => <option key={o.codigo} value={o.codigo}>{rotulo(o)}</option>)}
        </select>
      </label>
      <label className="largo">Atividade do Simples (cAtvSN)
        <select name="cativ_sn" defaultValue={valores?.cativSn?.trim() ?? ""}>
          <option value="">Usar a da empresa</option>
          {(op?.atividades ?? []).map((o) => <option key={o.codigo} value={o.codigo}>{rotulo(o)}</option>)}
        </select>
      </label>
    </fieldset>
  );
}
