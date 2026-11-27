import Link from "next/link";
import { redirect } from "next/navigation";
import { AcompanharNota } from "@/components/acompanhar-nota";
import { eEscritorio } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { diasParaVencer } from "@/lib/crypto/pfx";
import { empresaAtual } from "@/lib/empresa-atual";
import { codigoServico, documento } from "@/lib/formato";
import { competenciaAtual } from "@/lib/importacao/repetir-mes";
import { reais, somar } from "@/lib/money";
import { supabaseServidor } from "@/lib/supabase/server";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const ROTULO: Record<string, string> = { rascunho: "Rascunho", na_fila: "Na fila", enviando: "Enviando", autorizada: "Autorizada", rejeitada: "Rejeitada", cancelada: "Cancelada", substituida: "Substituída" };

/** As 6 competências que terminam na atual, como "AAAA-MM-01". */
function seisMeses(atual: string): string[] {
  const [a, m] = atual.split("-").map(Number) as [number, number];
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 1 - (5 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  });
}
const mes = (c: string) => MESES[Number(c.slice(5, 7)) - 1]!;

/** Painel de uma empresa: notas e faturamento do mês, 6 meses, o que precisa de atenção e atalhos. */
export default async function Painel() {
  const perfil = await perfilAtual();
  const empresa = await empresaAtual(perfil);
  if (!empresa) redirect(eEscritorio(perfil) ? "/empresas" : "/notas");
  const id = empresa.id;
  const atual = competenciaAtual();
  const meses = seisMeses(atual);
  const db = await supabaseServidor();
  const [{ data: notas }, { data: ultimas }, { count: tomadores }, { count: servicos }, { data: cert }, { data: topServicos }] = await Promise.all([
    db.from("nota").select("situacao, valor_servico, competencia").eq("empresa_id", id).gte("competencia", meses[0]!).limit(10000),
    db.from("nota").select("id, situacao, valor_servico, competencia, numero_nfse, motivo_rejeicao, tomador:tomador(nome)").eq("empresa_id", id).order("criado_em", { ascending: false }).limit(8),
    db.from("tomador").select("id", { count: "exact", head: true }).eq("empresa_id", id),
    db.from("servico").select("id", { count: "exact", head: true }).eq("empresa_id", id).eq("ativo", true),
    db.from("certificado").select("titular, valido_ate").eq("empresa_id", id).eq("ativo", true).maybeSingle(),
    db.from("servico").select("id, nome, descricao, codigo_tributacao_nacional").eq("empresa_id", id).eq("ativo", true).order("atualizado_em", { ascending: false }).limit(4),
  ]);

  const porMes = new Map<string, string[]>();
  const t = { autorizada: 0, fila: 0, rejeitada: 0, valor: [] as string[] };
  for (const n of notas ?? []) {
    if (n.situacao === "autorizada" && n.valor_servico != null && n.competencia) {
      porMes.set(n.competencia, [...(porMes.get(n.competencia) ?? []), String(n.valor_servico)]);
    }
    if (n.competencia !== atual) continue;
    if (n.situacao === "autorizada") { t.autorizada++; if (n.valor_servico != null) t.valor.push(String(n.valor_servico)); }
    else if (n.situacao === "na_fila" || n.situacao === "enviando") t.fila++;
    else if (n.situacao === "rejeitada") t.rejeitada++;
  }
  const qtd = t.autorizada + t.fila + t.rejeitada;
  const pct = (v: number) => (qtd ? `${(v / qtd) * 100}%` : "0%");
  const valores = meses.map((m) => { const l = porMes.get(m); return l?.length ? Number(somar(...l)) : 0; });
  const maior = Math.max(...valores, 0);
  const [, mesAtual] = atual.split("-").map(Number) as [number, number];
  const rejeitadas = (ultimas ?? []).filter((n) => n.situacao === "rejeitada");
  const dias = cert ? diasParaVencer(new Date(cert.valido_ate)) : null;
  const comp = atual.slice(0, 7);

  return (
    <>
      <div className="cab">
        <div>
          <h1>{empresa.razao_social}</h1>
          <p>CNPJ {documento(empresa.cnpj)} · {empresa.regime} · competência {MESES_LONGOS[mesAtual - 1]} de {atual.slice(0, 4)}</p>
        </div>
        <div className="acoes">
          <Link className="botao secundario" href="/importar">Importar XML / planilha</Link>
          <Link className="botao" href="/notas/nova">+ Nova nota</Link>
        </div>
      </div>

      {empresa.pausada && <div className="msg alerta">Emissão pausada{empresa.motivo_pausa ? `: ${empresa.motivo_pausa}` : ""}. <Link href={`/empresas/${id}`}>Ver no cadastro</Link></div>}
      {!cert && <div className="msg alerta">Esta empresa não tem certificado A1: a emissão fica parada. <Link href={`/empresas/${id}`}>Enviar certificado</Link></div>}
      {dias !== null && dias <= 30 && <div className="msg alerta">O certificado vence em {dias} {dias === 1 ? "dia" : "dias"}. <Link href={`/empresas/${id}`}>Trocar certificado</Link></div>}

      {t.fila > 0 && <AcompanharNota texto={`${t.fila} ${t.fila === 1 ? "nota na fila ou enviando" : "notas na fila ou enviando"} para a Receita. O painel atualiza sozinho.`} />}

      <div className="indicadores">
        <div className="indicador destaque">
          <span className="rot">Faturado no mês</span>
          <span className="val">{reais(t.valor.length ? somar(...t.valor) : 0)}</span>
          <span className="sub">{t.autorizada} {t.autorizada === 1 ? "nota autorizada" : "notas autorizadas"}</span>
          <div className="composicao" aria-label="Notas do mês por situação">
            <span style={{ width: pct(t.autorizada), background: "#22a565" }} />
            <span style={{ width: pct(t.fila), background: "#e0951e" }} />
            <span style={{ width: pct(t.rejeitada), background: "#e0483c" }} />
          </div>
        </div>
        <Link className="indicador" href={`/notas?situacao=autorizada&competencia=${comp}`}>
          <span className="rot">Autorizadas</span><span className="val">{t.autorizada}</span><span className="sub">neste mês</span>
        </Link>
        <Link className="indicador fila" href="/notas?situacao=na_fila">
          <span className="rot">Na fila ou enviando</span><span className="val">{t.fila}</span><span className="sub">a Receita responde em minutos</span>
        </Link>
        <Link className="indicador erro" href="/notas?situacao=rejeitada">
          <span className="rot">Rejeitadas</span><span className="val">{t.rejeitada}</span><span className="sub">{t.rejeitada ? "precisam de correção" : "nenhuma pendente"}</span>
        </Link>
      </div>

      <div className="duas">
        <div className="pilha">
          <section className="cartao" aria-labelledby="t-hist">
            <div className="cartao-cab"><h3 id="t-hist">Faturamento autorizado, 6 meses</h3><span className="suave">{reais(valores.reduce((a, b) => a + b, 0))} no período</span></div>
            <div className="historico grande">
              <div className="barras" role="img" aria-label={`Faturamento de ${mes(meses[0]!)} a ${mes(meses[5]!)}: ${valores.map((v) => reais(v)).join(", ")}`}>
                {valores.map((v, k) => <i key={k} title={`${mes(meses[k]!)}: ${reais(v)}`} style={{ height: maior ? `${Math.max(3, (v / maior) * 100)}%` : "3%" }} />)}
              </div>
              <div className="barras-meses">{meses.map((m, k) => <span key={m}><b>{mes(m)}</b>{reais(valores[k])}</span>)}</div>
            </div>
          </section>

          <section className="cartao" aria-labelledby="t-ultimas">
            <div className="cartao-cab"><h3 id="t-ultimas">Últimas notas</h3><Link href="/notas" className="suave">ver todas</Link></div>
            {(ultimas ?? []).length === 0 ? <p className="suave" style={{ margin: 0 }}>Nenhuma nota ainda. <Link href="/notas/nova">Emita a primeira</Link>.</p> : (
              <div className="lista">
                {(ultimas ?? []).map((n) => (
                  <div key={n.id}>
                    <div>
                      <strong>{(n.tomador as unknown as { nome: string } | null)?.nome ?? "sem tomador"}</strong>
                      <div className="suave">{n.competencia ? `${n.competencia.slice(5, 7)}/${n.competencia.slice(0, 4)}` : ""}{n.numero_nfse ? ` · nº ${n.numero_nfse}` : ""}</div>
                    </div>
                    <span className="acoes"><span className={`selo ${n.situacao}`}>{ROTULO[n.situacao]}</span><b>{reais(n.valor_servico)}</b>
                      <Link className="botao mini secundario" href={n.situacao === "rejeitada" || n.situacao === "rascunho" ? `/notas/nova?editar=${n.id}` : `/notas/${n.id}`}>{n.situacao === "rejeitada" ? "Corrigir" : "Abrir"}</Link></span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="pilha">
          <section className="cartao" aria-labelledby="t-atencao">
            <div className="cartao-cab"><h3 id="t-atencao">Precisa de atenção</h3>{t.rejeitada > 0 && <span className="selo rejeitada">{t.rejeitada}</span>}</div>
            {rejeitadas.length === 0 ? <p className="suave" style={{ margin: 0 }}>Nenhuma nota rejeitada. Tudo certo por aqui.</p> : (
              <div className="lista">
                {rejeitadas.map((n) => (
                  <div key={n.id}>
                    <div><strong>{(n.tomador as unknown as { nome: string } | null)?.nome ?? "sem tomador"}</strong><div className="suave">{n.motivo_rejeicao?.slice(0, 90)}</div></div>
                    <Link className="botao mini secundario" href={`/notas/nova?editar=${n.id}`}>Corrigir</Link>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="cartao atalhos" aria-label="Cadastros da empresa">
            <Link href="/tomadores"><b>{tomadores ?? 0}</b><span>Tomadores (clientes)</span></Link>
            <Link href="/servicos"><b>{servicos ?? 0}</b><span>Serviços</span></Link>
          </section>
          {(topServicos ?? []).length > 0 && (
            <section className="cartao" aria-labelledby="t-serv">
              <div className="cartao-cab"><h3 id="t-serv">Emitir com um serviço</h3></div>
              <div className="lista">
                {(topServicos ?? []).map((s) => (
                  <div key={s.id}>
                    <div><strong>{s.nome || s.descricao.slice(0, 50)}</strong><div className="suave">{codigoServico(s.codigo_tributacao_nacional)}</div></div>
                    <Link className="botao mini secundario" href={`/notas/nova?servico=${s.id}`}>Emitir</Link>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="cartao" aria-labelledby="t-cert">
            <div className="cartao-cab"><h3 id="t-cert">Certificado A1</h3></div>
            <p className="suave" style={{ margin: 0 }}>{cert ? `${cert.titular} · válido até ${new Date(cert.valido_ate).toLocaleDateString("pt-BR")}` : "Sem certificado."} <Link href={`/empresas/${id}`}>Cadastro da empresa</Link></p>
          </section>
        </aside>
      </div>
    </>
  );
}
