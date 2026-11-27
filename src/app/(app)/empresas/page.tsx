import Link from "next/link";
import { redirect } from "next/navigation";
import { eEscritorio } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { competenciaAtual } from "@/lib/importacao/repetir-mes";
import { reais, somar } from "@/lib/money";
import { documento } from "@/lib/formato";
import { supabaseServidor } from "@/lib/supabase/server";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const CORES = ["#2f6fbf", "#7a4fc9", "#1f8a5b", "#c0631d", "#2b3441", "#b0367a", "#0f7f8c", "#8a6d1d"];

/** As 6 competências que terminam na atual, como "AAAA-MM-01". */
function seisMeses(atual: string): string[] {
  const [a, m] = atual.split("-").map(Number) as [number, number];
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 1 - (5 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  });
}

function sigla(nome: string): string {
  return nome.replace(/\b(ltda|me|epp|eireli|s\/?a)\b\.?/gi, "").split(/\s+/).filter((p) => p.length > 2).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || nome.slice(0, 2).toUpperCase();
}

type Conta = { autorizada: number; fila: number; rejeitada: number; valorMes: string[]; porMes: Map<string, string[]> };

/**
 * Entrada do escritório: todas as empresas com as notas do mês e o faturamento de 6 meses. Clicar numa empresa
 * abre o painel dela e o menu passa a mostrar as telas daquela empresa.
 */
export default async function Empresas() {
  const perfil = await perfilAtual();
  if (!eEscritorio(perfil)) redirect(perfil.empresaId ? `/empresas/${perfil.empresaId}` : "/painel");
  const atual = competenciaAtual();
  const meses = seisMeses(atual);
  const db = await supabaseServidor();
  const [{ data: todas }, { data: notas }, { data: rejeitadas }, { data: avisos, count: totalAvisos }] = await Promise.all([
    db.from("empresa").select("id, razao_social, cnpj, regime, pausada, motivo_pausa, ativa").order("razao_social"),
    db.from("nota").select("empresa_id, situacao, valor_servico, competencia").gte("competencia", meses[0]!).limit(10000),
    db.from("nota").select("id, empresa_id, motivo_rejeicao, empresa:empresa_id(razao_social), tomador:tomador(nome)").eq("situacao", "rejeitada").order("criado_em", { ascending: false }).limit(5),
    db.from("aviso").select("id, mensagem, nota_id, empresa:empresa_id(razao_social)", { count: "exact" }).is("lido_em", null).order("quando", { ascending: false }).limit(4),
  ]);

  const ativas = (todas ?? []).filter((e) => e.ativa);
  const desativadas = (todas ?? []).filter((e) => !e.ativa);
  const abrir = (id: string, para = "/painel") => `/api/empresa-atual?id=${id}&para=${encodeURIComponent(para)}`;
  const conta = new Map<string, Conta>();
  const total = { autorizada: 0, fila: 0, rejeitada: 0, valor: [] as string[] };
  for (const n of notas ?? []) {
    const c: Conta = conta.get(n.empresa_id) ?? { autorizada: 0, fila: 0, rejeitada: 0, valorMes: [], porMes: new Map<string, string[]>() };
    conta.set(n.empresa_id, c);
    if (n.situacao === "autorizada" && n.valor_servico != null && n.competencia) {
      const lista = c.porMes.get(n.competencia) ?? [];
      lista.push(String(n.valor_servico));
      c.porMes.set(n.competencia, lista);
    }
    if (n.competencia !== atual) continue;
    if (n.situacao === "autorizada") {
      c.autorizada++; total.autorizada++;
      if (n.valor_servico != null) { c.valorMes.push(String(n.valor_servico)); total.valor.push(String(n.valor_servico)); }
    } else if (n.situacao === "na_fila" || n.situacao === "enviando") { c.fila++; total.fila++; }
    else if (n.situacao === "rejeitada") { c.rejeitada++; total.rejeitada++; }
  }
  const qtd = total.autorizada + total.fila + total.rejeitada;
  const pct = (v: number) => (qtd ? `${(v / qtd) * 100}%` : "0%");
  const [, mesAtual] = atual.split("-").map(Number) as [number, number];

  return (
    <>
      <div className="cab">
        <div>
          <h1>Empresas</h1>
          <p>Competência {MESES_LONGOS[mesAtual - 1]} de {atual.slice(0, 4)} · {ativas.length} empresas ativas · clique numa empresa para abrir o painel dela</p>
        </div>
        <div className="acoes">
          <Link className="botao" href="/empresas/nova">+ Cadastrar empresa</Link>
        </div>
      </div>

      <div className="indicadores">
        <div className="indicador destaque">
          <span className="rot">Faturado no mês</span>
          <span className="val">{reais(total.valor.length ? somar(...total.valor) : 0)}</span>
          <span className="sub">{total.autorizada} {total.autorizada === 1 ? "nota autorizada" : "notas autorizadas"}</span>
          <div className="composicao" aria-label="Notas do mês por situação">
            <span style={{ width: pct(total.autorizada), background: "#22a565" }} />
            <span style={{ width: pct(total.fila), background: "#e0951e" }} />
            <span style={{ width: pct(total.rejeitada), background: "#e0483c" }} />
          </div>
        </div>
        <Link className="indicador" href={`/notas?todas=1&situacao=autorizada&competencia=${atual.slice(0, 7)}`}>
          <span className="rot">Autorizadas</span><span className="val">{total.autorizada}</span><span className="sub">neste mês</span>
        </Link>
        <Link className="indicador fila" href="/notas?todas=1&situacao=na_fila">
          <span className="rot">Na fila ou enviando</span><span className="val">{total.fila}</span><span className="sub">a Receita responde em minutos</span>
        </Link>
        <Link className="indicador erro" href="/notas?todas=1&situacao=rejeitada">
          <span className="rot">Rejeitadas</span><span className="val">{total.rejeitada}</span><span className="sub">{total.rejeitada ? "precisam de correção" : "nenhuma pendente"}</span>
        </Link>
      </div>

      <div className="duas">
        <section className="pilha" aria-labelledby="t-empresas">
          <div className="cartao-cab" style={{ margin: 0 }}><h2 id="t-empresas" style={{ margin: 0 }}>Empresas</h2><span className="suave">notas deste mês · faturamento de 6 meses</span></div>
          {ativas.length === 0 && <div className="cartao suave">Nenhuma empresa ativa. <Link href="/empresas/nova">Cadastre a primeira</Link>.</div>}
          <div className="empresas">
            {ativas.map((e, i) => {
              const c = conta.get(e.id);
              const valores = meses.map((m) => { const l = c?.porMes.get(m); return l?.length ? Number(somar(...l)) : 0; });
              const maior = Math.max(...valores, 0);
              return (
                <article key={e.id} className="cartao empresa">
                  <div className="empresa-topo">
                    <span className="sigla" style={{ background: CORES[i % CORES.length] }} aria-hidden="true">{sigla(e.razao_social)}</span>
                    <div>
                      <strong><a href={abrir(e.id)}>{e.razao_social}</a></strong>
                      <span className="suave">{documento(e.cnpj)} · {e.regime}</span>
                    </div>
                  </div>
                  <div className="contagens">
                    <a href={abrir(e.id, `/notas?situacao=autorizada&competencia=${atual.slice(0, 7)}`)}><b>{c?.autorizada ?? 0}</b><small>autorizadas</small></a>
                    <a href={abrir(e.id, "/notas?situacao=na_fila")}><b>{c?.fila ?? 0}</b><small>na fila</small></a>
                    <a href={abrir(e.id, "/notas?situacao=rejeitada")} className={c?.rejeitada ? "tem-erro" : undefined}><b>{c?.rejeitada ?? 0}</b><small>{c?.rejeitada === 1 ? "rejeitada" : "rejeitadas"}</small></a>
                  </div>
                  <div className="historico">
                    <div className="barras" role="img" aria-label={`Faturamento autorizado de ${MESES[Number(meses[0]!.slice(5, 7)) - 1]} a ${MESES[mesAtual - 1]}: ${valores.map((v) => reais(v)).join(", ")}`}>
                      {valores.map((v, k) => <i key={k} title={`${MESES[Number(meses[k]!.slice(5, 7)) - 1]}: ${reais(v)}`} style={{ height: maior ? `${Math.max(4, (v / maior) * 100)}%` : "4%" }} />)}
                    </div>
                    <div className="barras-rot"><span>{MESES[Number(meses[0]!.slice(5, 7)) - 1]}</span><span>{MESES[mesAtual - 1]}</span></div>
                  </div>
                  <div className="empresa-pe">
                    {e.pausada
                      ? <span className="selo" title={e.motivo_pausa ?? undefined}>Pausada{e.motivo_pausa ? ` · ${e.motivo_pausa}` : ""}</span>
                      : <b>{reais(c?.valorMes.length ? somar(...c.valorMes) : 0)}</b>}
                    <span className="acoes"><Link className="botao mini secundario" href={`/empresas/${e.id}`}>Cadastro</Link><a className="botao mini" href={abrir(e.id)}>Abrir</a></span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="pilha">
          <section className="cartao" aria-labelledby="t-atencao">
            <div className="cartao-cab"><h3 id="t-atencao">Precisa de atenção</h3>{(rejeitadas ?? []).length > 0 && <span className="selo rejeitada">{(rejeitadas ?? []).length}</span>}</div>
            {(rejeitadas ?? []).length === 0 && <p className="suave" style={{ margin: 0 }}>Nenhuma nota rejeitada. Tudo certo por aqui.</p>}
            <div className="lista">
              {(rejeitadas ?? []).map((n) => (
                <div key={n.id}>
                  <div>
                    <strong>{(n.empresa as unknown as { razao_social: string } | null)?.razao_social}</strong>
                    <div className="suave">{(n.tomador as unknown as { nome: string } | null)?.nome ?? "sem tomador"}{n.motivo_rejeicao ? ` · ${n.motivo_rejeicao.slice(0, 90)}` : ""}</div>
                  </div>
                  <a className="botao mini secundario" href={abrir(n.empresa_id, `/notas/nova?editar=${n.id}`)}>Corrigir</a>
                </div>
              ))}
            </div>
          </section>
          <section className="cartao" aria-labelledby="t-avisos">
            <div className="cartao-cab"><h3 id="t-avisos">Avisos</h3>{(totalAvisos ?? 0) > 0 && <Link href="/avisos" className="suave">ver os {totalAvisos}</Link>}</div>
            {(avisos ?? []).length === 0 && <p className="suave" style={{ margin: 0 }}>Nenhum aviso novo.</p>}
            <div className="lista">
              {(avisos ?? []).map((a) => (
                <div key={a.id}>
                  <div>
                    <strong>{(a.empresa as unknown as { razao_social?: string } | null)?.razao_social ?? "Sistema"}</strong>
                    <div className="suave">{a.mensagem}</div>
                  </div>
                  {a.nota_id && <Link className="botao mini secundario" href={`/notas/${a.nota_id}`}>Abrir</Link>}
                </div>
              ))}
            </div>
          </section>
          {desativadas.length > 0 && (
            <section className="cartao" aria-labelledby="t-desativadas">
              <div className="cartao-cab"><h3 id="t-desativadas">Desativadas</h3><span className="suave">{desativadas.length}</span></div>
              <div className="lista">
                {desativadas.map((e) => (
                  <div key={e.id}>
                    <div><strong>{e.razao_social}</strong><div className="suave">{documento(e.cnpj)}</div></div>
                    <Link className="botao mini secundario" href={`/empresas/${e.id}`}>Reativar</Link>
                  </div>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
