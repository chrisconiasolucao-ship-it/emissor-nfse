import Link from "next/link";
import { perfilAtual } from "@/lib/auth/sessao";
import { supabaseServidor } from "@/lib/supabase/server";

const ROTULO: Record<string, string> = { rascunho: "Rascunho", na_fila: "Na fila", enviando: "Enviando", autorizada: "Autorizada", rejeitada: "Rejeitada", cancelada: "Cancelada", substituida: "Substituída" };
const reais = (v: string | null) => (v == null ? "—" : `R$ ${v.replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`);

export default async function Notas({ searchParams }: { searchParams: Promise<{ empresa?: string; situacao?: string; competencia?: string }> }) {
  await perfilAtual();
  const f = await searchParams;
  const db = await supabaseServidor();
  let q = db
    .from("nota")
    .select("id, empresa_id, situacao, competencia, descricao, valor_servico, numero_nfse, motivo_rejeicao, criado_em, empresa:empresa_id(razao_social), tomador:tomador(nome)")
    .order("criado_em", { ascending: false })
    .limit(300);
  if (f.empresa) q = q.eq("empresa_id", f.empresa);
  if (f.situacao) q = q.eq("situacao", f.situacao);
  if (f.competencia) q = q.eq("competencia", `${f.competencia}-01`);
  const [{ data }, { data: empresas }] = await Promise.all([q, db.from("empresa").select("id, razao_social").order("razao_social")]);
  return (
    <>
      <h1>Notas</h1>
      <form className="grade cartao" method="get">
        <label>Empresa
          <select name="empresa" defaultValue={f.empresa ?? ""}>
            <option value="">Todas</option>
            {(empresas ?? []).map((e) => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
          </select>
        </label>
        <label>Situação
          <select name="situacao" defaultValue={f.situacao ?? ""}>
            <option value="">Todas</option>
            {Object.entries(ROTULO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Competência<input type="month" name="competencia" defaultValue={f.competencia ?? ""} /></label>
        <div className="acoes"><button type="submit">Filtrar</button></div>
      </form>
      <div className="tabela">
        <table>
          <thead><tr><th>Situação</th><th>Empresa</th><th>Tomador</th><th>Competência</th><th className="num">Valor</th><th>Nº NFS-e</th></tr></thead>
          <tbody>
            {(data ?? []).map((n) => (
              <tr key={n.id}>
                <td>
                  <Link href={`/notas/${n.id}`}><span className={`selo ${n.situacao}`}>{ROTULO[n.situacao]}</span></Link>
                  {n.motivo_rejeicao && <div className="suave">{n.motivo_rejeicao}</div>}
                </td>
                <td>{(n.empresa as unknown as { razao_social: string } | null)?.razao_social}</td>
                <td>{(n.tomador as unknown as { nome: string } | null)?.nome ?? "—"}</td>
                <td>{n.competencia ? `${n.competencia.slice(5, 7)}/${n.competencia.slice(0, 4)}` : "—"}</td>
                <td className="num">{reais(n.valor_servico)}</td>
                <td>{n.numero_nfse ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(data ?? []).length === 0 && <p className="suave">Nenhuma nota com estes filtros.</p>}
    </>
  );
}
