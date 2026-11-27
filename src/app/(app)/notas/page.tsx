import Link from "next/link";
import { AcompanharNota } from "@/components/acompanhar-nota";
import { eEscritorio } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { empresaAtual } from "@/lib/empresa-atual";
import { competenciaAtual } from "@/lib/importacao/repetir-mes";
import { reais, somar } from "@/lib/money";
import { documento } from "@/lib/formato";
import { COLUNAS_IMPORTADA, periodo, semDuplicadas, type Importada } from "@/lib/notas/importadas";
import { supabaseServidor } from "@/lib/supabase/server";

const ROTULO: Record<string, string> = { rascunho: "Rascunho", na_fila: "Na fila", enviando: "Enviando", autorizada: "Autorizada", rejeitada: "Rejeitada", cancelada: "Cancelada", substituida: "Substituída", importada: "Importada" };
const FILTROS: [string, string][] = [["", "Todas"], ["autorizada", "Autorizadas"], ["importada", "Importadas"], ["na_fila", "Na fila"], ["rejeitada", "Rejeitadas"], ["rascunho", "Rascunhos"], ["cancelada", "Canceladas"]];
const TIPOS: [string, string][] = [["", "Prestadas (emitidas e importadas)"], ["tomada", "Tomadas (importadas)"], ["todas", "Prestadas e tomadas"]];
const LIMITE = 500;

type Filtro = { empresa?: string; situacao?: string; competencia?: string; de?: string; ate?: string; tipo?: string; todas?: string };

type Linha = {
  id: string;
  empresaId: string;
  importada: boolean;
  papel: "prestada" | "tomada";
  situacao: string;
  nome: string;
  doc: string | null;
  motivo: string | null;
  empresa: string | null;
  competencia: string | null;
  valor: string | number | null;
  numero: string | null;
  criado: string;
};

const mesAno = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

export default async function Notas({ searchParams }: { searchParams: Promise<Filtro> }) {
  const perfil = await perfilAtual();
  const busca = await searchParams;
  // Com uma empresa aberta, a tela mostra só as notas dela; "todas=1" (menu do escritório) mostra todas.
  const aberta = await empresaAtual(perfil);
  const daAberta = Boolean(aberta) && !(eEscritorio(perfil) && busca.todas);
  const f: Filtro = daAberta ? { ...busca, empresa: aberta!.id, todas: undefined } : busca;
  const { de, ate } = periodo(f, competenciaAtual().slice(0, 7));
  const tipo = f.tipo === "tomada" || f.tipo === "todas" ? f.tipo : "";
  const situacao = f.situacao ?? "";
  const verSistema = tipo !== "tomada" && situacao !== "importada";
  const verImportadas = situacao === "" || situacao === "autorizada" || situacao === "importada";

  const link = (sit: string) => {
    const u = new URLSearchParams();
    if (f.todas) u.set("todas", "1");
    if (f.empresa && !daAberta) u.set("empresa", f.empresa);
    u.set("de", de ?? "");
    u.set("ate", ate ?? "");
    if (tipo) u.set("tipo", tipo);
    if (sit) u.set("situacao", sit);
    return `/notas?${u.toString()}`;
  };

  const db = await supabaseServidor();
  let q = db
    .from("nota")
    .select("id, empresa_id, situacao, competencia, descricao, valor_servico, numero_nfse, motivo_rejeicao, criado_em, empresa:empresa_id(razao_social), tomador:tomador(nome, documento)")
    .order("criado_em", { ascending: false })
    .limit(LIMITE);
  if (f.empresa) q = q.eq("empresa_id", f.empresa);
  if (situacao && situacao !== "importada") q = q.eq("situacao", situacao);
  if (de) q = q.gte("competencia", `${de}-01`);
  if (ate) q = q.lte("competencia", `${ate}-01`);

  let qi = db.from("documento").select(`${COLUNAS_IMPORTADA}, criado_em, empresa:empresa_id(razao_social)`).eq("tipo", "xml_origem").not("papel", "is", null)
    .order("competencia", { ascending: false, nullsFirst: false }).limit(LIMITE);
  if (f.empresa) qi = qi.eq("empresa_id", f.empresa);
  if (tipo === "") qi = qi.eq("papel", "prestada");
  if (tipo === "tomada") qi = qi.eq("papel", "tomada");
  if (de) qi = qi.gte("competencia", `${de}-01`);
  if (ate) qi = qi.lte("competencia", `${ate}-01`);

  // números das notas do sistema no período, para não contar duas vezes a que também voltou pelo ADN
  let qn = db.from("nota").select("empresa_id, numero_nfse").not("numero_nfse", "is", null).limit(10000);
  if (f.empresa) qn = qn.eq("empresa_id", f.empresa);

  // notas na fila ou enviando no escopo da tela (sem o filtro de situação): enquanto houver, a lista se atualiza sozinha
  let qf = db.from("nota").select("id", { count: "exact", head: true }).in("situacao", ["na_fila", "enviando"]);
  if (f.empresa) qf = qf.eq("empresa_id", f.empresa);

  const [{ data: doSistema }, imp, { data: numeros }, { data: empresas }, { count: naFila }] = await Promise.all([
    verSistema ? q : Promise.resolve({ data: [] as never[] }),
    verImportadas ? qi : Promise.resolve({ data: [] as never[], error: null }),
    verImportadas ? qn : Promise.resolve({ data: [] as never[] }),
    db.from("empresa").select("id, razao_social").order("razao_social"),
    qf,
  ]);
  const importadas = semDuplicadas((imp.data ?? []) as unknown as (Importada & { criado_em: string; empresa: { razao_social: string } | null })[], numeros ?? []);

  const linhas: Linha[] = [
    ...(doSistema ?? []).map((n): Linha => {
      const t = n.tomador as unknown as { nome: string; documento: string } | null;
      return {
        id: n.id, empresaId: n.empresa_id, importada: false, papel: "prestada", situacao: n.situacao, nome: t?.nome ?? "—", doc: t?.documento ?? null,
        motivo: n.motivo_rejeicao, empresa: (n.empresa as unknown as { razao_social: string } | null)?.razao_social ?? null,
        competencia: n.competencia, valor: n.valor_servico, numero: n.numero_nfse, criado: n.criado_em,
      };
    }),
    ...importadas.map((d): Linha => ({
      id: d.id, empresaId: d.empresa_id, importada: true, papel: d.papel === "tomada" ? "tomada" : "prestada", situacao: "importada",
      nome: d.outra_parte ?? d.nome_original ?? "NFS-e", doc: d.outra_parte_documento, motivo: null, empresa: d.empresa?.razao_social ?? null,
      competencia: d.competencia, valor: d.valor, numero: d.numero_nfse, criado: d.criado_em,
    })),
  ].sort((a, b) => (b.competencia ?? "").localeCompare(a.competencia ?? "") || b.criado.localeCompare(a.criado));

  // faturamento do período: prestadas autorizadas do sistema + prestadas importadas (sem repetir)
  const faturadas = linhas.filter((l) => l.papel === "prestada" && (l.situacao === "autorizada" || l.situacao === "importada") && l.valor != null);
  const faturamento = faturadas.length ? somar(...faturadas.map((l) => String(l.valor))) : "0.00";
  const tomadas = linhas.filter((l) => l.papel === "tomada" && l.valor != null);
  const nomeEmpresa = (empresas ?? []).find((e) => e.id === f.empresa)?.razao_social;
  const textoPeriodo = de && ate ? (de === ate ? `competência ${mesAno(de)}` : `competências ${mesAno(de)} a ${mesAno(ate)}`) : de ? `desde ${mesAno(de)}` : ate ? `até ${mesAno(ate)}` : "todos os meses";

  return (
    <>
      <div className="cab">
        <div>
          <h1>Notas</h1>
          <p>{nomeEmpresa ?? "Todas as empresas"} · {textoPeriodo} · {linhas.length} {linhas.length === 1 ? "nota" : "notas"}</p>
        </div>
        <div className="acoes">{daAberta && <Link className="botao secundario" href={`/baixar?de=${de ?? ""}&ate=${ate ?? ""}&tipo=${tipo === "tomada" ? "tomadas" : tipo === "todas" ? "ambas" : "prestadas"}`}>Baixar em lote</Link>}<Link className="botao" href={daAberta ? "/notas/nova" : f.empresa ? `/api/empresa-atual?id=${f.empresa}&para=/notas/nova` : "/empresas"}>+ Nova nota</Link></div>
      </div>

      {(naFila ?? 0) > 0 && <AcompanharNota texto={`${naFila} ${naFila === 1 ? "nota na fila ou enviando" : "notas na fila ou enviando"} para a Receita. A lista atualiza sozinha.`} />}

      <nav className="filtros" aria-label="Situação">
        {FILTROS.map(([k, v]) => (
          <Link key={k} className="filtro" href={link(k)} aria-current={situacao === k ? "true" : undefined}>{v}</Link>
        ))}
      </nav>

      <form className="grade cartao" method="get" style={{ gridTemplateColumns: daAberta ? "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.4fr) auto" : "minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.4fr) auto", alignItems: "end" }}>
        {situacao && <input type="hidden" name="situacao" value={situacao} />}
        {f.todas && <input type="hidden" name="todas" value="1" />}
        {!daAberta && <label>Empresa
          <select name="empresa" defaultValue={f.empresa ?? ""}>
            <option value="">Todas</option>
            {(empresas ?? []).map((e) => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
          </select>
        </label>}
        <label>Competência de<input type="month" name="de" defaultValue={de ?? ""} /></label>
        <label>até<input type="month" name="ate" defaultValue={ate ?? ""} /></label>
        <label>Notas
          <select name="tipo" defaultValue={tipo}>
            {TIPOS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <div className="acoes"><button type="submit" className="secundario">Filtrar</button></div>
      </form>
      <p className="suave" style={{ margin: "0 0 12px" }}>Deixe as competências em branco para ver todos os meses.</p>

      {linhas.length > 0 && (
        <div className="filtros" style={{ marginBottom: 12 }}>
          {tipo !== "tomada" && <span className="cartao" style={{ padding: "8px 14px" }}>Faturamento no período: <b>{reais(faturamento)}</b> <span className="suave">({faturadas.length} {faturadas.length === 1 ? "nota" : "notas"}, emitidas e importadas)</span></span>}
          {tipo !== "" && <span className="cartao" style={{ padding: "8px 14px" }}>Tomadas: <b>{reais(tomadas.length ? somar(...tomadas.map((l) => String(l.valor))) : "0.00")}</b> <span className="suave">({tomadas.length})</span></span>}
        </div>
      )}

      {linhas.length > 0 ? (
        <div className="tabela">
          <table>
            <thead><tr><th>Situação</th><th>{tipo === "tomada" ? "Prestador" : "Tomador / outra parte"}</th>{!daAberta && <th>Empresa</th>}<th>Competência</th><th className="num">Valor</th><th>Nº NFS-e</th><th><span className="so-leitor">Ações</span></th></tr></thead>
            <tbody>
              {linhas.map((n) => (
                <tr key={n.id} className={n.situacao === "rejeitada" ? "com-erro" : undefined}>
                  <td>
                    <span className={`selo ${n.importada ? "autorizada" : n.situacao}`}>{ROTULO[n.situacao]}</span>
                    {n.importada && <> <span className={`etiqueta ${n.papel}`}>{n.papel}</span></>}
                  </td>
                  <td>
                    <strong>{n.nome}</strong>
                    {n.motivo ? <span className="suave" style={{ color: "var(--erro)" }}>{n.motivo}</span> : n.doc && <span className="suave">{documento(n.doc)}</span>}
                  </td>
                  {!daAberta && <td className="suave">{n.empresa}</td>}
                  <td>{n.competencia ? mesAno(n.competencia) : "—"}</td>
                  <td className="num"><b>{reais(n.valor)}</b></td>
                  <td className="num">{n.numero ?? "—"}</td>
                  <td className="num nowrap">
                    {n.importada
                      ? <>
                        <a className="botao mini secundario" href={`/api/documentos/${n.id}`}>Baixar XML</a>
                        {n.papel === "prestada" && daAberta && <> <Link className="botao mini secundario" href={`/notas/nova?documento=${n.id}`}>Usar como modelo</Link></>}
                      </>
                      : n.situacao === "rejeitada" || n.situacao === "rascunho"
                        ? <Link className="botao mini" href={daAberta ? `/notas/nova?editar=${n.id}` : `/api/empresa-atual?id=${n.empresaId}&para=${encodeURIComponent(`/notas/nova?editar=${n.id}`)}`}>{n.situacao === "rejeitada" ? "Corrigir" : "Continuar"}</Link>
                        : <Link className="botao mini secundario" href={`/notas/${n.id}`}>Abrir</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="cartao suave">Nenhuma nota com estes filtros. <Link href={`/notas?de=&ate=${f.todas ? "&todas=1" : ""}`}>Ver todos os meses</Link>{daAberta && <> ou <Link href="/notas/nova">emitir uma nota</Link></>}.</div>
      )}
      {linhas.length >= LIMITE && <p className="suave">Mostrando as {LIMITE} mais recentes de cada origem. Use os filtros para ver as demais.</p>}
    </>
  );
}
