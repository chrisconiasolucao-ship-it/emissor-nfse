/**
 * Repetir o mês anterior (AT-020): um rascunho por nota AUTORIZADA da empresa na competência anterior,
 * com a competência atual. Rodar de novo para o mesmo mês não duplica: a importação do tipo
 * 'repeticao' é única por (empresa, competência) no banco (AT-031).
 */
export type NotaAutorizada = {
  id: string;
  tomadorId: string | null;
  servicoId: string | null;
  codigoTributacaoNacional: string | null;
  codigoNbs: string | null;
  descricao: string;
  codMunicipioPrestacao: string | null;
  valorServico: string;
  issRetido: boolean;
  aliquotaIss: string | null;
};

export type Rascunho = Omit<NotaAutorizada, "id"> & { competencia: string; origem: "repeticao"; notaModeloId: string };

export function mesAnterior(competencia: string): string {
  const [a, m] = competencia.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function competenciaAtual(agora = new Date(), fuso = "America/Sao_Paulo"): string {
  const [a, m] = new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit" }).format(agora).split("-");
  return `${a}-${m}-01`;
}

export function rascunhosDoMes(autorizadas: NotaAutorizada[], competencia: string): Rascunho[] {
  return autorizadas.map(({ id, ...resto }) => ({ ...resto, competencia, origem: "repeticao", notaModeloId: id }));
}

type Db = { from: (t: string) => any; rpc?: unknown }; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Grava a importação 'repeticao' e os rascunhos. Com o cliente do usuário, a RLS limita à empresa dele.
 * Se a importação do mês já existe, nada é criado e a função diz isso.
 */
export async function repetirMes(db: Db, empresaId: string, competencia: string, usuarioId: string): Promise<{ criadas: number; jaExistia: boolean }> {
  const anterior = mesAnterior(competencia);
  const { data: notas, error } = await db
    .from("nota")
    .select("id, tomador_id, servico_id, codigo_tributacao_nacional, codigo_nbs, descricao, cod_municipio_prestacao, valor_servico, iss_retido, aliquota_iss")
    .eq("empresa_id", empresaId)
    .eq("competencia", anterior)
    .eq("situacao", "autorizada")
    .order("criado_em");
  if (error) throw new Error(`não leu as notas de ${anterior.slice(0, 7)}: ${error.message}`);

  const imp = await db
    .from("importacao")
    .insert({ empresa_id: empresaId, tipo: "repeticao", competencia, linhas: (notas ?? []).length, criado_por: usuarioId })
    .select("id")
    .single();
  if (imp.error) {
    if (imp.error.code === "23505") return { criadas: 0, jaExistia: true };
    throw new Error(`não gravou a importação: ${imp.error.message}`);
  }

  const rascunhos = rascunhosDoMes(
    ((notas ?? []) as Record<string, unknown>[]).map((n) => ({
      id: String(n.id),
      tomadorId: (n.tomador_id as string | null) ?? null,
      servicoId: (n.servico_id as string | null) ?? null,
      codigoTributacaoNacional: (n.codigo_tributacao_nacional as string | null) ?? null,
      codigoNbs: (n.codigo_nbs as string | null) ?? null,
      descricao: String(n.descricao),
      codMunicipioPrestacao: (n.cod_municipio_prestacao as string | null) ?? null,
      valorServico: String(n.valor_servico),
      issRetido: Boolean(n.iss_retido),
      aliquotaIss: n.aliquota_iss == null ? null : String(n.aliquota_iss),
    })),
    competencia,
  );
  if (rascunhos.length === 0) return { criadas: 0, jaExistia: false };
  const { error: e2 } = await db.from("nota").insert(
    rascunhos.map((r) => ({
      empresa_id: empresaId,
      situacao: "rascunho",
      origem: "repeticao",
      competencia: r.competencia,
      tomador_id: r.tomadorId,
      servico_id: r.servicoId,
      codigo_tributacao_nacional: r.codigoTributacaoNacional,
      codigo_nbs: r.codigoNbs,
      descricao: r.descricao,
      cod_municipio_prestacao: r.codMunicipioPrestacao,
      valor_servico: r.valorServico,
      iss_retido: r.issRetido,
      aliquota_iss: r.aliquotaIss,
      importacao_id: imp.data.id,
      criado_por: usuarioId,
    })),
  );
  if (e2) throw new Error(`não criou os rascunhos: ${e2.message}`);
  return { criadas: rascunhos.length, jaExistia: false };
}
