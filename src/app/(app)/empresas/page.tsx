import Link from "next/link";
import { EscolhaEmpresa } from "@/components/escolha-empresa";
import { redirect } from "next/navigation";
import { eEscritorio } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { competenciaAtual } from "@/lib/importacao/repetir-mes";
import { reais, somar } from "@/lib/money";
import { semDuplicadas } from "@/lib/notas/importadas";
import { documento } from "@/lib/formato";
import { supabaseServidor } from "@/lib/supabase/server";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** As 6 competências que terminam na atual, como "AAAA-MM-01". */
function seisMeses(atual: string): string[] {
  const [a, m] = atual.split("-").map(Number) as [number, number];
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 1 - (5 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  });
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
  const [{ data: todas }, { data: notas }, { data: rejeitadas }, { data: avisos, count: totalAvisos }, { data: importadas }, { data: numeros }] = await Promise.all([
    db.from("empresa").select("id, razao_social, cnpj, regime, pausada, motivo_pausa, ativa").order("razao_social"),
    db.from("nota").select("empresa_id, situacao, valor_servico, competencia").gte("competencia", meses[0]!).limit(10000),
    db.from("nota").select("id, empresa_id, motivo_rejeicao, empresa:empresa_id(razao_social), tomador:tomador(nome)").eq("situacao", "rejeitada").order("criado_em", { ascending: false }).limit(5),
    db.from("aviso").select("id, mensagem, nota_id, empresa:empresa_id(razao_social)", { count: "exact" }).is("lido_em", null).order("quando", { ascending: false }).limit(4),
    // prestadas importadas (ADN ou XML) também entram no faturamento, sem repetir as emitidas aqui
    db.from("documento").select("empresa_id, numero_nfse, competencia, valor").eq("tipo", "xml_origem").eq("papel", "prestada").gte("competencia", meses[0]!).limit(10000),
    db.from("nota").select("empresa_id, numero_nfse").not("numero_nfse", "is", null).limit(10000),
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
  for (const d of semDuplicadas(importadas ?? [], numeros ?? [])) {
    if (d.valor == null || !d.competencia) continue;
    const c: Conta = conta.get(d.empresa_id) ?? { autorizada: 0, fila: 0, rejeitada: 0, valorMes: [], porMes: new Map<string, string[]>() };
    conta.set(d.empresa_id, c);
    c.porMes.set(d.competencia, [...(c.porMes.get(d.competencia) ?? []), String(d.valor)]);
    if (d.competencia === atual) { c.valorMes.push(String(d.valor)); total.valor.push(String(d.valor)); }
  }
  const linhas = ativas.map((e) => {
    const c = conta.get(e.id);
    const valores = meses.map((m) => { const l = c?.porMes.get(m); return l?.length ? Number(somar(...l)) : 0; });
    return { e, c, valores, maior: Math.max(...valores, 0), mes: valores[5] ?? 0 };
  }).sort((x, y) => (y.c?.rejeitada ?? 0) - (x.c?.rejeitada ?? 0) || y.mes - x.mes);
  const qtd = total.autorizada + total.fila + total.rejeitada;
  const pct = (v: number) => (qtd ? `${(v / qtd) * 100}%` : "0%");
  const [, mesAtual] = atual.split("-").map(Number) as [number, number];

  return (
    <>
      <div className="cab">
        <div>
          <h1>Empresas</h1>
          <p>Competência {MESES_LONGOS[mesAtual - 1]} de {atual.slice(0, 4)} · {ativas.length} empresas ativas · visão geral de todas</p>
        </div>
        <div className="acoes">
          <Link className="botao secundario" href="/empresas/gerenciar">Gerenciar empresas</Link>
          <Link className="botao" href="/empresas/nova">+ Cadastrar empresa</Link>
        </div>
      </div>

      <section className="cartao abrir-empresa" aria-labelledby="t-abrir">
        <div className="cartao-cab" style={{ margin: 0 }}><h2 id="t-abrir">Abrir uma empresa</h2><span className="suave">o menu passa a mostrar painel, notas, tomadores e serviços dela</span></div>
        <EscolhaEmpresa empresas={ativas.map((e) => ({ id: e.id, titulo: e.razao_social, detalhe: `CNPJ ${documento(e.cnpj)} · ${e.regime}`, direita: e.pausada ? "pausada" : undefined }))} autoFoco />
      </section>

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
        <Link className="indicador fila" href="/notas?todas=1&situacao=na_fila&de=&ate=">
          <span className="rot">Na fila ou enviando</span><span className="val">{total.fila}</span><span className="sub">a Receita responde em minutos</span>
        </Link>
        <Link className="indicador erro" href="/notas?todas=1&situacao=rejeitada&de=&ate=">
          <span className="rot">Rejeitadas</span><span className="val">{total.rejeitada}</span><span className="sub">{total.rejeitada ? "precisam de correção" : "nenhuma pendente"}</span>
        </Link>
      </div>

      <div className="duas">
        <section className="cartao lista-cadastro" aria-labelledby="t-empresas">
          <div className="cartao-cab busca-linha" style={{ margin: 0 }}><h2 id="t-empresas" style={{ margin: 0 }}>Resumo por empresa</h2><span className="suave dir">notas deste mês · faturamento de 6 meses</span></div>
          {ativas.length === 0 ? <p className="suave" style={{ padding: 16, margin: 0 }}>Nenhuma empresa ativa. <Link href="/empresas/nova">Cadastre a primeira</Link>.</p> : (
            <div className="tabela sem-borda">
              <table className="resumo-empresas">
                <thead><tr><th>Empresa</th><th className="num">Autorizadas</th><th className="num">Na fila</th><th className="num">Rejeitadas</th><th>6 meses</th><th className="num">Faturado no mês</th><th><span className="so-leitor">Ações</span></th></tr></thead>
                <tbody>
                  {linhas.map(({ e, c, valores, maior, mes }) => (
                    <tr key={e.id}>
                      <td>
                        <a className="nome-link" href={abrir(e.id)}>{e.razao_social}</a>
                        <span className="suave">{documento(e.cnpj)} · {e.regime}{e.pausada ? " · pausada" : ""}</span>
                      </td>
                      <td className="num"><a href={abrir(e.id, `/notas?situacao=autorizada&competencia=${atual.slice(0, 7)}`)}>{c?.autorizada ?? 0}</a></td>
                      <td className="num"><a href={abrir(e.id, "/notas?situacao=na_fila")}>{c?.fila ?? 0}</a></td>
                      <td className={`num${c?.rejeitada ? " tem-erro" : ""}`}><a href={abrir(e.id, "/notas?situacao=rejeitada")}>{c?.rejeitada ?? 0}</a></td>
                      <td>
                        <span className="barras mini" role="img" aria-label={`Faturamento de ${MESES[Number(meses[0]!.slice(5, 7)) - 1]} a ${MESES[mesAtual - 1]}: ${valores.map((v) => reais(v)).join(", ")}`}>
                          {valores.map((v, k) => <i key={k} title={`${MESES[Number(meses[k]!.slice(5, 7)) - 1]}: ${reais(v)}`} style={{ height: maior ? `${Math.max(8, (v / maior) * 100)}%` : "8%" }} />)}
                        </span>
                      </td>
                      <td className="num"><b>{reais(mes)}</b></td>
                      <td className="num"><a className="botao mini" href={abrir(e.id)}>Abrir</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
