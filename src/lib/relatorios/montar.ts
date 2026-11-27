import "server-only";
import { eEscritorio, type Perfil } from "@/lib/auth/permissoes";
import { diasParaVencer } from "@/lib/crypto/pfx";
import type { EmpresaAtual } from "@/lib/empresa-atual";
import { codigoServico, documento } from "@/lib/formato";
import { competenciaAtual } from "@/lib/importacao/repetir-mes";
import { lerValor, somar } from "@/lib/money";
import type { supabaseServidor } from "@/lib/supabase/server";
import {
  AVISO_LIMITE, COMPETENCIA, LIMITE_ANUAL, dataBR, faturamentoMensal, intervalo, issPorMunicipio, issRetido,
  mesAno, mesCurto, mesLongo, percentualLimite, periodo, somarMeses, total,
} from "./calculos";
import type { Celula, ChaveRelatorio, Filtros, Relatorio, Selo } from "./tipos";

type Db = Awaited<ReturnType<typeof supabaseServidor>>;
type Opcao = { id: string; nome: string };

/** O que a tela de filtros precisa além do relatório: listas para os selects e os filtros já resolvidos. */
export type Montado = {
  relatorio: Relatorio;
  filtros: Required<Pick<Filtros, "de" | "ate" | "ano" | "competencia">> & Filtros;
  empresaId: string | null;
  empresas: Opcao[];
  tomadores: Opcao[];
  servicos: Opcao[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROTULO: Record<string, string> = { rascunho: "Rascunho", na_fila: "Na fila", enviando: "Enviando", autorizada: "Autorizada", rejeitada: "Rejeitada", cancelada: "Cancelada", substituida: "Substituída" };
export const SITUACOES: [string, string][] = [["", "Emitidas (autorizadas, canceladas e substituídas)"], ["autorizada", "Só autorizadas"], ["cancelada", "Só canceladas"], ["substituida", "Só substituídas"], ["rejeitada", "Só rejeitadas"], ["na_fila", "Na fila"]];
export const TIPOS_OCORRENCIA: [string, string][] = [["", "Todas"], ["cancelada", "Canceladas"], ["substituida", "Substituídas"], ["rejeitada", "Rejeitadas"]];

/** PostgREST devolve no máximo 1000 linhas por vez: lê em páginas até acabar (limite de segurança 50 mil). */
async function todas<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; de < 50_000; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const um = <T,>(x: unknown): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null)) as T | null;
const numeroNota = (n: { numero_nfse: string | null; serie_dps?: string | null; numero_dps?: number | null }) =>
  n.numero_nfse ?? (n.numero_dps ? `DPS ${n.serie_dps ?? ""}-${n.numero_dps}` : "—");

export async function montarRelatorio(chave: ChaveRelatorio, db: Db, perfil: Perfil, aberta: EmpresaAtual | null, busca: Filtros): Promise<Montado> {
  const escritorio = eEscritorio(perfil);
  const hoje = competenciaAtual().slice(0, 7);
  const comp = (s: string | undefined, padrao: string) => (s && COMPETENCIA.test(s) ? s : padrao);
  const f = {
    ...busca,
    de: comp(busca.de, hoje),
    ate: comp(busca.ate, hoje),
    ano: busca.ano && /^\d{4}$/.test(busca.ano) ? busca.ano : hoje.slice(0, 4),
    competencia: comp(busca.competencia, hoje),
  };
  if (f.de > f.ate) [f.de, f.ate] = [f.ate, f.de];
  if (intervalo(f.de, f.ate).length >= 60) f.de = somarMeses(f.ate, -59);

  // Escopo: cliente vê só a própria empresa; escritório usa a escolhida no filtro, senão a aberta, senão todas.
  let empresaId: string | null;
  if (!escritorio) empresaId = perfil.empresaId;
  else if (busca.empresa === "todas") empresaId = null;
  else if (busca.empresa && UUID.test(busca.empresa)) empresaId = busca.empresa;
  else empresaId = aberta?.id ?? null;

  const { data: listaEmpresas } = await db.from("empresa").select("id, razao_social, cnpj, regime").eq("ativa", true).order("razao_social");
  const empresas = (listaEmpresas ?? []) as { id: string; razao_social: string; cnpj: string; regime: string }[];
  const empresa = empresaId ? empresas.find((e) => e.id === empresaId) ?? null : null;
  const nomeEscopo = empresa ? `${empresa.razao_social} · CNPJ ${documento(empresa.cnpj)}` : empresaId ? "Empresa" : "Todas as empresas";

  let tomadores: Opcao[] = [];
  let servicos: Opcao[] = [];
  if (chave === "notas" && empresaId) {
    const [t, s] = await Promise.all([
      db.from("tomador").select("id, nome, documento").eq("empresa_id", empresaId).order("nome").limit(2000),
      db.from("servico").select("id, nome, descricao, codigo_tributacao_nacional").eq("empresa_id", empresaId).order("descricao").limit(2000),
    ]);
    tomadores = (t.data ?? []).map((x) => ({ id: x.id, nome: `${x.nome} · ${documento(x.documento)}` }));
    servicos = (s.data ?? []).map((x) => ({ id: x.id, nome: `${codigoServico(x.codigo_tributacao_nacional)} · ${x.nome ?? x.descricao}` }));
  }

  const base = { filtros: f, empresaId, empresas: empresas.map((e) => ({ id: e.id, nome: e.razao_social })), tomadores, servicos };
  const varias = !empresaId;
  const ini = `${f.de}-01`;
  const fim = `${f.ate}-01`;

  /* ---------------------------------------------------------------- 1. Notas emitidas */
  if (chave === "notas") {
    const situacoes = f.situacao && ROTULO[f.situacao] ? [f.situacao] : ["autorizada", "cancelada", "substituida"];
    const notas = await todas((a, b) => {
      let q = db.from("nota")
        .select("id, empresa_id, situacao, competencia, valor_servico, iss_retido, aliquota_iss, codigo_tributacao_nacional, numero_nfse, serie_dps, numero_dps, autorizada_em, criado_em, empresa:empresa_id(razao_social), tomador:tomador(nome, documento)")
        .gte("competencia", ini).lte("competencia", fim).in("situacao", situacoes)
        .order("competencia").order("autorizada_em", { nullsFirst: false }).order("criado_em").range(a, b);
      if (empresaId) q = q.eq("empresa_id", empresaId);
      if (f.tomador && UUID.test(f.tomador)) q = q.eq("tomador_id", f.tomador);
      if (f.servico && UUID.test(f.servico)) q = q.eq("servico_id", f.servico);
      return q;
    });
    const autorizadas = notas.filter((n) => n.situacao === "autorizada");
    const linhas: Celula[][] = notas.map((n) => {
      const t = um<{ nome: string; documento: string }>(n.tomador);
      return [
        { texto: numeroNota(n), href: `/notas/${n.id}` },
        dataBR(n.autorizada_em ?? n.criado_em),
        mesAno(n.competencia),
        ...(varias ? [um<{ razao_social: string }>(n.empresa)?.razao_social ?? "—"] : []),
        t?.nome ?? "—",
        documento(t?.documento),
        codigoServico(n.codigo_tributacao_nacional),
        n.valor_servico == null ? null : String(n.valor_servico),
        issRetido(n),
        { selo: n.situacao, texto: ROTULO[n.situacao] ?? n.situacao },
      ];
    });
    const colunas = [
      { rotulo: "Nº NFS-e" }, { rotulo: "Emissão" }, { rotulo: "Compet." },
      ...(varias ? [{ rotulo: "Empresa", largura: 1.4 }] : []),
      { rotulo: "Tomador", largura: 1.6 }, { rotulo: "CPF/CNPJ" }, { rotulo: "Serviço" },
      { rotulo: "Valor", tipo: "valor" as const }, { rotulo: "ISS retido", tipo: "valor" as const }, { rotulo: "Situação", tipo: "selo" as const },
    ];
    const vazios = colunas.length - 6;
    const totalValor = total(autorizadas.map((n) => n.valor_servico));
    return {
      ...base,
      relatorio: {
        titulo: "Notas emitidas",
        subtitulo: `${nomeEscopo} · competência ${periodo(f.de, f.ate)}`,
        colunas,
        linhas,
        total: [`Total das autorizadas (${autorizadas.length} ${autorizadas.length === 1 ? "nota" : "notas"})`, ...Array<Celula>(vazios).fill(null), totalValor, total(autorizadas.map(issRetido)), null],
        destaques: [
          { rotulo: "Notas autorizadas", valor: String(autorizadas.length) },
          { rotulo: "Valor autorizado", valor: `R$ ${valorCurto(totalValor)}` },
          { rotulo: "Canceladas ou substituídas", valor: String(notas.filter((n) => n.situacao === "cancelada" || n.situacao === "substituida").length) },
        ],
        observacoes: ["Canceladas e substituídas aparecem na lista mas não entram no total."],
        vazio: "Nenhuma nota neste período com estes filtros.",
      },
    };
  }

  /* ---------------------------------------------------------------- 2. Faturamento mensal */
  if (chave === "faturamento") {
    const notas = await todas((a, b) => {
      let q = db.from("nota").select("competencia, valor_servico, iss_retido, aliquota_iss")
        .eq("situacao", "autorizada").gte("competencia", `${Number(f.ano) - 1}-01-01`).lte("competencia", `${f.ano}-12-01`)
        .order("competencia").range(a, b);
      if (empresaId) q = q.eq("empresa_id", empresaId);
      return q;
    });
    const meses = faturamentoMensal(notas, f.ano);
    const doAno = meses.at(-1)!.acumuladoAno;
    const corrente = f.ano === hoje.slice(0, 4);
    const decorridos = corrente ? Number(hoje.slice(5, 7)) : 12;
    const media = lerValor(doAno).div(decorridos).toDecimalPlaces(2).toFixed(2);
    const rbtAtual = meses[(corrente ? Number(hoje.slice(5, 7)) : 12) - 1]!.rbt12;
    const pct = empresa ? percentualLimite(doAno, empresa.regime) : null;
    const destaques = [
      { rotulo: `Faturado em ${f.ano}`, valor: `R$ ${valorCurto(doAno)}`, sub: pct == null ? undefined : `${pct.toLocaleString("pt-BR")}% do limite ${empresa!.regime} (R$ ${valorCurto(LIMITE_ANUAL[empresa!.regime]!)})` },
      { rotulo: corrente ? `RBT12 de ${mesLongo(hoje)}` : "RBT12 de dezembro", valor: `R$ ${valorCurto(rbtAtual)}`, sub: "12 meses anteriores" },
      { rotulo: "Média mensal", valor: `R$ ${valorCurto(media)}`, sub: corrente ? `${decorridos} ${decorridos === 1 ? "mês" : "meses"} do ano` : undefined },
      { rotulo: "Notas autorizadas", valor: String(meses.reduce((s, m) => s + m.notas, 0)) },
    ];
    const observacoes = ["Soma só notas autorizadas emitidas por este sistema, pela competência. Canceladas e substituídas não entram.", "RBT12: receita dos 12 meses anteriores ao mês, como no PGDAS-D."];
    if (pct != null && pct >= AVISO_LIMITE * 100) observacoes.unshift(`Atenção: o faturamento do ano já está em ${pct.toLocaleString("pt-BR")}% do limite do ${empresa!.regime}.`);
    return {
      ...base,
      relatorio: {
        titulo: "Faturamento mensal",
        subtitulo: `${nomeEscopo} · ano ${f.ano}`,
        colunas: [{ rotulo: "Mês" }, { rotulo: "Notas", tipo: "inteiro" }, { rotulo: "Faturado", tipo: "valor" }, { rotulo: "ISS retido", tipo: "valor" }, { rotulo: "Acumulado no ano", tipo: "valor" }, { rotulo: "RBT12", tipo: "valor" }],
        linhas: meses.map((m) => [`${mesLongo(m.competencia)}/${f.ano}`, m.notas, m.valor, m.issRetido, m.acumuladoAno, m.rbt12]),
        total: [`Total ${f.ano}`, meses.reduce((s, m) => s + m.notas, 0), doAno, total(meses.map((m) => m.issRetido)), null, null],
        destaques,
        grafico: meses.map((m) => ({ rotulo: mesCurto(m.competencia), valor: m.valor })),
        observacoes,
        vazio: "Nenhuma nota autorizada neste ano.",
      },
    };
  }

  /* ---------------------------------------------------------------- 3. ISS e retenções */
  if (chave === "iss") {
    const notas = await todas((a, b) => {
      let q = db.from("nota").select("competencia, valor_servico, iss_retido, aliquota_iss, cod_municipio_prestacao")
        .eq("situacao", "autorizada").gte("competencia", ini).lte("competencia", fim).order("competencia").range(a, b);
      if (empresaId) q = q.eq("empresa_id", empresaId);
      return q;
    });
    const grupos = issPorMunicipio(notas);
    const codigos = grupos.map((g) => g.codigo).filter(Boolean);
    const { data: municipios } = codigos.length ? await db.from("municipio_situacao").select("cod_ibge, nome, uf").in("cod_ibge", codigos) : { data: [] };
    const nome = new Map((municipios ?? []).map((m) => [m.cod_ibge, `${m.nome}/${m.uf}`]));
    const comRet = total(grupos.map((g) => g.comRetencao));
    return {
      ...base,
      relatorio: {
        titulo: "ISS e retenções",
        subtitulo: `${nomeEscopo} · competência ${periodo(f.de, f.ate)}`,
        colunas: [{ rotulo: "Município de prestação", largura: 1.6 }, { rotulo: "Notas", tipo: "inteiro" }, { rotulo: "Receita", tipo: "valor" }, { rotulo: "ISS no DAS (sem retenção)", tipo: "valor" }, { rotulo: "Com ISS retido", tipo: "valor" }, { rotulo: "Alíquota retida" }, { rotulo: "ISS retido pelo tomador", tipo: "valor" }],
        linhas: grupos.map((g) => [
          g.codigo ? (nome.get(g.codigo) ?? `IBGE ${g.codigo}`) : "Sem município",
          g.notas, g.receita, g.semRetencao, g.comRetencao,
          g.aliquotas.length ? g.aliquotas.map((x) => `${x.replace(".", ",")}%`).join(", ") : "—",
          g.issRetido,
        ]),
        total: ["Total", grupos.reduce((s, g) => s + g.notas, 0), total(grupos.map((g) => g.receita)), total(grupos.map((g) => g.semRetencao)), comRet, null, total(grupos.map((g) => g.issRetido))],
        destaques: [
          { rotulo: "Receita do período", valor: `R$ ${valorCurto(total(grupos.map((g) => g.receita)))}` },
          { rotulo: "Receita com ISS retido", valor: `R$ ${valorCurto(comRet)}`, sub: "no PGDAS-D: com retenção de ISS" },
          { rotulo: "ISS retido pelos tomadores", valor: `R$ ${valorCurto(total(grupos.map((g) => g.issRetido)))}` },
        ],
        observacoes: [
          "Só notas autorizadas. Sem retenção, o ISS é recolhido no DAS e o valor sai no cálculo do PGDAS-D, não aqui.",
          "No PGDAS-D, informe a receita com ISS retido separada, para não pagar o ISS duas vezes.",
        ],
        vazio: "Nenhuma nota autorizada neste período.",
      },
    };
  }

  /* ---------------------------------------------------------------- 4. Notas tomadas (ADN) */
  if (chave === "tomadas") {
    const docs = await todas((a, b) => {
      let q = db.from("documento").select("id, empresa_id, numero_nfse, competencia, outra_parte, outra_parte_documento, valor, criado_em, empresa:empresa_id(razao_social)")
        .eq("tipo", "xml_origem").eq("papel", "tomada").gte("competencia", ini).lt("competencia", `${somarMeses(f.ate, 1)}-01`)
        .order("competencia").order("criado_em").range(a, b);
      if (empresaId) q = q.eq("empresa_id", empresaId);
      return q;
    });
    return {
      ...base,
      relatorio: {
        titulo: "Notas tomadas (ADN)",
        subtitulo: `${nomeEscopo} · competência ${periodo(f.de, f.ate)}`,
        colunas: [{ rotulo: "Nº NFS-e" }, { rotulo: "Compet." }, ...(varias ? [{ rotulo: "Empresa (tomadora)", largura: 1.4 }] : []), { rotulo: "Prestador", largura: 1.8 }, { rotulo: "CPF/CNPJ do prestador" }, { rotulo: "Valor", tipo: "valor" as const }, { rotulo: "XML" }],
        linhas: docs.map((d) => [
          d.numero_nfse ?? "—", mesAno(d.competencia),
          ...(varias ? [um<{ razao_social: string }>(d.empresa)?.razao_social ?? "—"] : []),
          d.outra_parte ?? "—", documento(d.outra_parte_documento), d.valor == null ? null : String(d.valor),
          { texto: "baixar", href: `/api/documentos/${d.id}` },
        ]),
        total: [`Total tomado (${docs.length} ${docs.length === 1 ? "nota" : "notas"})`, null, ...(varias ? [null] : []), null, null, total(docs.map((d) => d.valor)), null],
        observacoes: ["Notas baixadas do ADN em que a empresa é a tomadora. Para trazer notas novas, use Importar → Buscar no ADN."],
        vazio: "Nenhuma nota tomada neste período. Use Importar → Buscar no ADN para baixar as notas da Receita.",
      },
    };
  }

  /* ---------------------------------------------------------------- 5. Canceladas, substituídas e rejeitadas */
  if (chave === "ocorrencias") {
    const tipos = f.tipo && ["cancelada", "substituida", "rejeitada"].includes(f.tipo) ? [f.tipo] : ["cancelada", "substituida", "rejeitada"];
    const notas = await todas((a, b) => {
      let q = db.from("nota").select("id, empresa_id, situacao, competencia, valor_servico, numero_nfse, serie_dps, numero_dps, codigo_rejeicao, motivo_rejeicao, criado_por, atualizado_em, empresa:empresa_id(razao_social), tomador:tomador(nome)")
        .in("situacao", tipos).gte("competencia", ini).lte("competencia", fim).order("atualizado_em", { ascending: false }).range(a, b);
      if (empresaId) q = q.eq("empresa_id", empresaId);
      return q;
    });
    const ids = notas.map((n) => n.id);
    const eventos: { nota_id: string; tipo: string; codigo_motivo: string; motivo: string; registrado_por: string; registrado_em: string; nota_substituta_id: string | null }[] = [];
    for (let k = 0; k < ids.length; k += 200) {
      const { data } = await db.from("evento_nota").select("nota_id, tipo, codigo_motivo, motivo, registrado_por, registrado_em, nota_substituta_id").in("nota_id", ids.slice(k, k + 200)).order("registrado_em", { ascending: false });
      eventos.push(...(data ?? []));
    }
    const eventoDe = new Map<string, (typeof eventos)[number]>();
    for (const e of eventos) if (!eventoDe.has(e.nota_id)) eventoDe.set(e.nota_id, e);
    const substitutas = [...new Set(eventos.map((e) => e.nota_substituta_id).filter((x): x is string => Boolean(x)))];
    const { data: subs } = substitutas.length ? await db.from("nota").select("id, numero_nfse, serie_dps, numero_dps").in("id", substitutas) : { data: [] };
    const numSub = new Map((subs ?? []).map((s) => [s.id, numeroNota(s)]));
    const usuarios = [...new Set([...eventos.map((e) => e.registrado_por), ...notas.map((n) => n.criado_por)].filter((x): x is string => Boolean(x)))];
    const { data: perfis } = usuarios.length ? await db.from("perfil_usuario").select("usuario_id, nome, email").in("usuario_id", usuarios) : { data: [] };
    const nomeUsuario = new Map((perfis ?? []).map((p) => [p.usuario_id, p.nome ?? p.email ?? "—"]));

    const selo: Record<string, Selo> = { cancelada: { selo: "cancelada", texto: "Cancelada" }, substituida: { selo: "substituida", texto: "Substituída" }, rejeitada: { selo: "rejeitada", texto: "Rejeitada" } };
    const linhas: Celula[][] = notas.map((n) => {
      const e = eventoDe.get(n.id);
      const motivo = n.situacao === "rejeitada"
        ? [n.codigo_rejeicao, n.motivo_rejeicao].filter(Boolean).join(" · ") || "—"
        : e ? `${e.codigo_motivo} · ${e.motivo}${e.nota_substituta_id ? ` (substituída pela ${numSub.get(e.nota_substituta_id) ?? "nova nota"})` : ""}` : "—";
      const quem = n.situacao === "rejeitada" ? n.criado_por : e?.registrado_por;
      return [
        ...(varias ? [um<{ razao_social: string }>(n.empresa)?.razao_social ?? "—"] : []),
        { texto: numeroNota(n), href: `/notas/${n.id}` },
        mesAno(n.competencia),
        um<{ nome: string }>(n.tomador)?.nome ?? "—",
        n.valor_servico == null ? null : String(n.valor_servico),
        selo[n.situacao] ?? { selo: n.situacao, texto: n.situacao },
        dataBR(e?.registrado_em ?? n.atualizado_em, true),
        motivo,
        quem ? (nomeUsuario.get(quem) ?? "escritório") : "—",
      ];
    });
    const conta = (s: string) => notas.filter((n) => n.situacao === s).length;
    return {
      ...base,
      relatorio: {
        titulo: "Canceladas, substituídas e rejeitadas",
        subtitulo: `${nomeEscopo} · competência ${periodo(f.de, f.ate)}`,
        colunas: [...(varias ? [{ rotulo: "Empresa", largura: 1.3 }] : []), { rotulo: "Nota" }, { rotulo: "Compet." }, { rotulo: "Tomador", largura: 1.3 }, { rotulo: "Valor", tipo: "valor" as const }, { rotulo: "Tipo", tipo: "selo" as const }, { rotulo: "Data" }, { rotulo: "Motivo / rejeição", largura: 2.6 }, { rotulo: "Por" }],
        linhas,
        destaques: [
          { rotulo: "Canceladas", valor: String(conta("cancelada")) },
          { rotulo: "Substituídas", valor: String(conta("substituida")) },
          { rotulo: "Rejeitadas (a corrigir)", valor: String(conta("rejeitada")) },
        ],
        observacoes: ["Rejeitada é a nota que a Receita recusou e ainda não foi corrigida: abra a nota para corrigir e reenviar."],
        vazio: "Nenhuma nota cancelada, substituída ou rejeitada neste período.",
      },
    };
  }

  /* ---------------------------------------------------------------- 6. Resumo da carteira (escritório) */
  if (!escritorio) throw new Error("O resumo da carteira é só para o escritório.");
  const c = f.competencia;
  const doRegime = empresas.filter((e) => !f.regime || e.regime === f.regime);
  const [notas, pendentes, certs] = await Promise.all([
    todas((a, b) => db.from("nota").select("empresa_id, competencia, valor_servico").eq("situacao", "autorizada")
      .gte("competencia", `${somarMeses(c, -12)}-01`).lte("competencia", `${c}-01`).order("empresa_id").range(a, b)),
    todas((a, b) => db.from("nota").select("empresa_id, situacao").in("situacao", ["rejeitada", "na_fila", "enviando"]).order("empresa_id").range(a, b)),
    db.from("certificado").select("empresa_id, valido_ate").eq("ativo", true),
  ]);
  const anoIni = `${c.slice(0, 4)}-01`;
  const certDe = new Map((certs.data ?? []).map((x) => [x.empresa_id, x.valido_ate as string]));
  const linhas: Celula[][] = [];
  const somaMes: string[] = [];
  let qtdMes = 0;
  let atencao = 0;
  for (const e of doRegime) {
    const daEmpresa = notas.filter((n) => n.empresa_id === e.id && n.competencia && n.valor_servico != null);
    const noMes = daEmpresa.filter((n) => n.competencia!.slice(0, 7) === c);
    const valorMes = total(noMes.map((n) => n.valor_servico));
    // ano até o mês escolhido (as notas lidas começam 12 meses antes, então o ano está inteiro nelas)
    const noAno = total(daEmpresa.filter((n) => n.competencia!.slice(0, 7) >= anoIni && n.competencia!.slice(0, 7) <= c).map((n) => n.valor_servico));
    const rbt12 = total(daEmpresa.filter((n) => n.competencia!.slice(0, 7) < c).map((n) => n.valor_servico));
    const pend: Selo[] = [];
    const rej = pendentes.filter((p) => p.empresa_id === e.id && p.situacao === "rejeitada").length;
    const fila = pendentes.filter((p) => p.empresa_id === e.id && p.situacao !== "rejeitada").length;
    if (rej) pend.push({ selo: "rejeitada", texto: `${rej} rejeitada${rej > 1 ? "s" : ""}` });
    if (fila) pend.push({ selo: "na_fila", texto: `${fila} na fila` });
    const pct = percentualLimite(noAno, e.regime);
    if (pct != null && pct >= AVISO_LIMITE * 100) pend.push({ selo: pct >= 100 ? "rejeitada" : "na_fila", texto: `${pct.toLocaleString("pt-BR")}% do limite ${e.regime}` });
    if (!noMes.length) pend.push({ selo: "alerta", texto: "sem notas no mês" });
    const validade = certDe.get(e.id);
    const dias = validade ? diasParaVencer(new Date(validade)) : null;
    const cert: Celula = dias == null ? { selo: "rejeitada", texto: "sem certificado" }
      : dias < 0 ? { selo: "rejeitada", texto: `vencido em ${dataBR(validade)}` }
        : dias <= 30 ? { selo: "na_fila", texto: `vence em ${dias} ${dias === 1 ? "dia" : "dias"}` }
          : `vence ${dataBR(validade)}`;
    if (pend.some((p) => p.selo !== "alerta") || (dias != null && dias <= 30) || dias == null) atencao++;
    somaMes.push(valorMes);
    qtdMes += noMes.length;
    linhas.push([
      { texto: e.razao_social, href: `/api/empresa-atual?id=${e.id}&para=/painel` },
      documento(e.cnpj), e.regime, noMes.length, valorMes, noAno, rbt12,
      pend.length ? pend : { selo: "autorizada", texto: "nenhuma" },
      cert,
    ]);
  }
  return {
    ...base,
    relatorio: {
      titulo: "Resumo da carteira",
      subtitulo: `${f.regime ? `Empresas ${f.regime}` : "Todas as empresas"} · competência ${mesAno(c)}`,
      colunas: [{ rotulo: "Empresa", largura: 1.6 }, { rotulo: "CNPJ" }, { rotulo: "Regime" }, { rotulo: "Notas no mês", tipo: "inteiro" }, { rotulo: "Faturado no mês", tipo: "valor" }, { rotulo: `Acumulado ${c.slice(0, 4)}`, tipo: "valor" }, { rotulo: "RBT12", tipo: "valor" }, { rotulo: "Pendências", tipo: "selo", largura: 1.4 }, { rotulo: "Certificado", tipo: "selo" }],
      linhas,
      total: [`${doRegime.length} ${doRegime.length === 1 ? "empresa" : "empresas"}`, null, null, qtdMes, somaMes.length ? somar(...somaMes) : "0.00", null, null, null, null],
      destaques: [
        { rotulo: "Empresas", valor: String(doRegime.length) },
        { rotulo: `Notas em ${mesLongo(c)}`, valor: String(qtdMes) },
        { rotulo: `Faturado em ${mesLongo(c)}`, valor: `R$ ${valorCurto(somaMes.length ? somar(...somaMes) : "0.00")}` },
        { rotulo: "Precisam de atenção", valor: String(atencao), sub: "rejeitadas, fila, limite ou certificado" },
      ],
      observacoes: ["Faturamento só de notas autorizadas emitidas por este sistema. RBT12: 12 meses anteriores à competência.", "Rejeitadas e notas na fila contam em qualquer competência."],
      vazio: "Nenhuma empresa ativa com estes filtros.",
    },
  };
}

/** "1234.5" → "1.234,50" (para os destaques). */
function valorCurto(v: string): string {
  const [int, dec] = lerValor(v).toFixed(2).split(".");
  return `${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}
