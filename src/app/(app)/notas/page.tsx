import Link from "next/link";
import { perfilAtual } from "@/lib/auth/sessao";
import { reais } from "@/lib/money";
import { documento } from "@/lib/formato";
import { supabaseServidor } from "@/lib/supabase/server";

const ROTULO: Record<string, string> = { rascunho: "Rascunho", na_fila: "Na fila", enviando: "Enviando", autorizada: "Autorizada", rejeitada: "Rejeitada", cancelada: "Cancelada", substituida: "Substituída" };
const FILTROS: [string, string][] = [["", "Todas"], ["autorizada", "Autorizadas"], ["na_fila", "Na fila"], ["rejeitada", "Rejeitadas"], ["rascunho", "Rascunhos"], ["cancelada", "Canceladas"]];

type Filtro = { empresa?: string; situacao?: string; competencia?: string };

function link(f: Filtro, situacao: string): string {
  const u = new URLSearchParams();
  if (f.empresa) u.set("empresa", f.empresa);
  if (f.competencia) u.set("competencia", f.competencia);
  if (situacao) u.set("situacao", situacao);
  const s = u.toString();
  return s ? `/notas?${s}` : "/notas";
}

export default async function Notas({ searchParams }: { searchParams: Promise<Filtro> }) {
  await perfilAtual();
  const f = await searchParams;
  const db = await supabaseServidor();
  let q = db
    .from("nota")
    .select("id, empresa_id, situacao, competencia, descricao, valor_servico, numero_nfse, motivo_rejeicao, criado_em, empresa:empresa_id(razao_social), tomador:tomador(nome, documento)")
    .order("criado_em", { ascending: false })
    .limit(300);
  if (f.empresa) q = q.eq("empresa_id", f.empresa);
  if (f.situacao) q = q.eq("situacao", f.situacao);
  if (f.competencia) q = q.eq("competencia", `${f.competencia}-01`);
  const [{ data }, { data: empresas }] = await Promise.all([q, db.from("empresa").select("id, razao_social").order("razao_social")]);
  const nomeEmpresa = (empresas ?? []).find((e) => e.id === f.empresa)?.razao_social;
  return (
    <>
      <div className="cab">
        <div>
          <h1>Notas</h1>
          <p>{nomeEmpresa ?? "Todas as empresas"}{f.competencia ? ` · competência ${f.competencia.slice(5, 7)}/${f.competencia.slice(0, 4)}` : ""} · {(data ?? []).length} {(data ?? []).length === 1 ? "nota" : "notas"}</p>
        </div>
        <div className="acoes"><Link className="botao" href={f.empresa ? `/notas/nova?empresa=${f.empresa}` : "/notas/nova"}>+ Nova nota</Link></div>
      </div>

      <nav className="filtros" aria-label="Situação">
        {FILTROS.map(([k, v]) => (
          <Link key={k} className="filtro" href={link(f, k)} aria-current={(f.situacao ?? "") === k ? "true" : undefined}>{v}</Link>
        ))}
      </nav>

      <form className="grade cartao" method="get" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) auto", alignItems: "end" }}>
        {f.situacao && <input type="hidden" name="situacao" value={f.situacao} />}
        <label>Empresa
          <select name="empresa" defaultValue={f.empresa ?? ""}>
            <option value="">Todas</option>
            {(empresas ?? []).map((e) => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
          </select>
        </label>
        <label>Competência<input type="month" name="competencia" defaultValue={f.competencia ?? ""} /></label>
        <div className="acoes"><button type="submit" className="secundario">Filtrar</button></div>
      </form>

      {(data ?? []).length > 0 ? (
        <div className="tabela">
          <table>
            <thead><tr><th>Situação</th><th>Tomador</th><th>Empresa</th><th>Competência</th><th className="num">Valor</th><th>Nº NFS-e</th><th><span className="so-leitor">Ações</span></th></tr></thead>
            <tbody>
              {(data ?? []).map((n) => {
                const t = n.tomador as unknown as { nome: string; documento: string } | null;
                return (
                  <tr key={n.id} className={n.situacao === "rejeitada" ? "com-erro" : undefined}>
                    <td><span className={`selo ${n.situacao}`}>{ROTULO[n.situacao]}</span></td>
                    <td>
                      <strong>{t?.nome ?? "—"}</strong>
                      {n.motivo_rejeicao ? <span className="suave" style={{ color: "var(--erro)" }}>{n.motivo_rejeicao}</span> : t?.documento && <span className="suave">{documento(t.documento)}</span>}
                    </td>
                    <td className="suave">{(n.empresa as unknown as { razao_social: string } | null)?.razao_social}</td>
                    <td>{n.competencia ? `${n.competencia.slice(5, 7)}/${n.competencia.slice(0, 4)}` : "—"}</td>
                    <td className="num"><b>{reais(n.valor_servico)}</b></td>
                    <td className="num">{n.numero_nfse ?? "—"}</td>
                    <td className="num">
                      {n.situacao === "rejeitada" || n.situacao === "rascunho"
                        ? <Link className="botao mini" href={`/notas/nova?editar=${n.id}`}>{n.situacao === "rejeitada" ? "Corrigir" : "Continuar"}</Link>
                        : <Link className="botao mini secundario" href={`/notas/${n.id}`}>Abrir</Link>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="cartao suave">Nenhuma nota com estes filtros. <Link href="/notas">Ver todas</Link> ou <Link href="/notas/nova">emitir uma nota</Link>.</div>
      )}
    </>
  );
}
