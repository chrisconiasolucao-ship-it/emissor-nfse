import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eEscritorio } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { empresaAtual } from "@/lib/empresa-atual";
import { reais } from "@/lib/money";
import { textoExibido } from "@/lib/relatorios/exportar";
import { SITUACOES, TIPOS_OCORRENCIA, montarRelatorio } from "@/lib/relatorios/montar";
import { CAMPOS_FILTRO, RELATORIOS, eChave, type Celula, type Coluna, type Filtros } from "@/lib/relatorios/tipos";
import { supabaseServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function Celula({ c, col }: { c: Celula; col: Coluna }) {
  if (Array.isArray(c)) return <span className="selos">{c.map((s, k) => <span key={k} className={`selo ${s.selo}`}>{s.texto}</span>)}</span>;
  if (c && typeof c === "object" && "selo" in c) return <span className={`selo ${c.selo}`}>{c.texto}</span>;
  if (c && typeof c === "object" && "href" in c) return c.href.startsWith("/api/") ? <a href={c.href}>{c.texto}</a> : <Link href={c.href}>{c.texto}</Link>;
  return <>{textoExibido(c, col)}</>;
}

export default async function Relatorio({ params, searchParams }: { params: Promise<{ tipo: string }>; searchParams: Promise<Filtros> }) {
  const { tipo } = await params;
  if (!eChave(tipo)) notFound();
  const meta = RELATORIOS.find((r) => r.chave === tipo)!;
  const perfil = await perfilAtual();
  const escritorio = eEscritorio(perfil);
  if (meta.soEscritorio && !escritorio) redirect("/relatorios");
  const busca = await searchParams;
  const aberta = await empresaAtual(perfil);
  const db = await supabaseServidor();
  const m = await montarRelatorio(tipo, db, perfil, aberta, busca);
  const r = m.relatorio;
  const f = m.filtros;

  // Os mesmos filtros (já resolvidos) vão para o PDF e o Excel.
  const qs = new URLSearchParams();
  for (const k of CAMPOS_FILTRO) {
    const v = k === "empresa" ? (escritorio ? (m.empresaId ?? "todas") : undefined) : f[k];
    if (v) qs.set(k, v);
  }
  const exportar = (formato: string) => `/api/relatorios/${tipo}?${qs.toString()}&formato=${formato}`;
  const usaPeriodo = tipo === "notas" || tipo === "iss" || tipo === "tomadas" || tipo === "ocorrencias";
  const maior = Math.max(0, ...(r.grafico ?? []).map((b) => Number(b.valor) || 0));

  return (
    <>
      <div className="cab">
        <div>
          <p style={{ margin: 0 }}><Link href="/relatorios">Relatórios</Link></p>
          <h1>{r.titulo}</h1>
          <p>{r.subtitulo}</p>
        </div>
        <div className="acoes">
          <a className="botao secundario" href={exportar("xlsx")}>Baixar Excel</a>
          <a className="botao" href={exportar("pdf")}>Baixar PDF</a>
        </div>
      </div>

      <form className="cartao filtros-relatorio" method="get">
        {escritorio && tipo !== "carteira" && (
          <label>Empresa
            <select name="empresa" defaultValue={m.empresaId ?? "todas"}>
              <option value="todas">Todas as empresas</option>
              {m.empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </label>
        )}
        {usaPeriodo && <>
          <label>Competência de<input type="month" name="de" defaultValue={f.de} required /></label>
          <label>até<input type="month" name="ate" defaultValue={f.ate} required /></label>
        </>}
        {tipo === "faturamento" && <label>Ano<input type="number" name="ano" min={2020} max={2100} defaultValue={f.ano} required /></label>}
        {tipo === "carteira" && <>
          <label>Competência<input type="month" name="competencia" defaultValue={f.competencia} required /></label>
          <label>Regime
            <select name="regime" defaultValue={f.regime ?? ""}>
              <option value="">Todos</option><option value="MEI">MEI</option><option value="ME">ME</option><option value="EPP">EPP</option>
            </select>
          </label>
        </>}
        {tipo === "notas" && <>
          <label>Situação
            <select name="situacao" defaultValue={f.situacao ?? ""}>{SITUACOES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          {m.empresaId && <>
            <label>Tomador
              <select name="tomador" defaultValue={f.tomador ?? ""}><option value="">Todos</option>{m.tomadores.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}</select>
            </label>
            <label>Serviço
              <select name="servico" defaultValue={f.servico ?? ""}><option value="">Todos</option>{m.servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select>
            </label>
          </>}
        </>}
        {tipo === "ocorrencias" && (
          <label>Tipo
            <select name="tipo" defaultValue={f.tipo ?? ""}>{TIPOS_OCORRENCIA.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
        )}
        <div className="acoes"><button type="submit" className="secundario">Filtrar</button></div>
      </form>

      {r.destaques && (
        <div className="indicadores">
          {r.destaques.map((d) => <div key={d.rotulo} className="indicador"><span className="rot">{d.rotulo}</span><span className="val relatorio-val">{d.valor}</span>{d.sub && <span className="sub">{d.sub}</span>}</div>)}
        </div>
      )}

      {r.grafico && (
        <div className="cartao historico grande">
          <div className="barras" aria-hidden="true">
            {r.grafico.map((b) => <i key={b.rotulo} title={`${b.rotulo}: ${reais(b.valor)}`} style={{ height: maior ? `${Math.max(2, (Number(b.valor) / maior) * 100)}%` : "2%", background: "var(--primaria)" }} />)}
          </div>
          <div className="barras-meses" style={{ gridTemplateColumns: `repeat(${r.grafico.length}, minmax(0, 1fr))` }}>
            {r.grafico.map((b) => <span key={b.rotulo}><b>{b.rotulo}</b>{Number(b.valor) ? reais(b.valor).replace(/,\d\d$/, "") : "—"}</span>)}
          </div>
        </div>
      )}

      {r.linhas.length > 0 ? (
        <div className="tabela">
          <table>
            <thead><tr>{r.colunas.map((c) => <th key={c.rotulo} className={c.tipo === "valor" || c.tipo === "inteiro" ? "num" : undefined}>{c.rotulo}</th>)}</tr></thead>
            <tbody>
              {r.linhas.map((l, k) => (
                <tr key={k}>{r.colunas.map((c, i) => <td key={i} className={c.tipo === "valor" || c.tipo === "inteiro" ? "num" : undefined}><Celula c={l[i] ?? null} col={c} /></td>)}</tr>
              ))}
            </tbody>
            {r.total && (
              <tfoot><tr className="total">{r.colunas.map((c, i) => <td key={i} className={c.tipo === "valor" || c.tipo === "inteiro" ? "num" : undefined}>{r.total![i] == null ? "" : <Celula c={r.total![i]!} col={c} />}</td>)}</tr></tfoot>
            )}
          </table>
        </div>
      ) : (
        <div className="cartao suave">{r.vazio}</div>
      )}

      {r.observacoes?.map((o) => <p key={o} className="suave" style={{ margin: 0 }}>{o}</p>)}
    </>
  );
}
