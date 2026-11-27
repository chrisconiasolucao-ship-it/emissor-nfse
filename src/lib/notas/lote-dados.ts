import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COLUNAS_IMPORTADA } from "./importadas";
import { SITUACOES_COM_XML, type EventoGuardado, type Guardado, type ImportadaGuardada, type NotaSistema } from "./lote";

const PAGINA = 1000; // teto de linhas por consulta do PostgREST
const LOTE_IDS = 200; // ids por filtro "in", para a URL não ficar enorme

/** Lê todas as páginas de uma consulta (o PostgREST devolve no máximo 1000 linhas por vez). */
async function todas<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    saida.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGINA) return saida;
  }
}

async function porIds<T>(ids: string[], ler: (lote: string[]) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const saida: T[] = [];
  for (let i = 0; i < ids.length; i += LOTE_IDS) {
    const { data, error } = await ler(ids.slice(i, i + LOTE_IDS));
    if (error) throw new Error(error.message);
    saida.push(...((data ?? []) as T[]));
  }
  return saida;
}

/**
 * Tudo o que entra no lote de uma empresa no período (competência "AAAA-MM", de/até opcionais), lido com a
 * sessão do usuário: o RLS decide o que ele pode ver.
 */
export async function lerDadosDoLote(db: SupabaseClient, empresaId: string, de?: string, ate?: string) {
  const notas = await todas<NotaSistema>((a, b) => {
    let q = db.from("nota")
      .select("id, empresa_id, situacao, numero_nfse, competencia, valor_servico, documento_id, danfse_documento_id, tomador:tomador(nome, documento)")
      .eq("empresa_id", empresaId).in("situacao", [...SITUACOES_COM_XML]).not("documento_id", "is", null)
      .order("competencia").order("numero_nfse").range(a, b);
    if (de) q = q.gte("competencia", `${de}-01`);
    if (ate) q = q.lte("competencia", `${ate}-01`);
    return q;
  });

  const importadas = await todas<ImportadaGuardada>((a, b) => {
    let q = db.from("documento").select(`${COLUNAS_IMPORTADA}, storage_path, sha256`)
      .eq("empresa_id", empresaId).eq("tipo", "xml_origem").not("papel", "is", null)
      .order("competencia").order("numero_nfse").range(a, b);
    if (de) q = q.gte("competencia", `${de}-01`);
    if (ate) q = q.lte("competencia", `${ate}-01`);
    return q;
  });

  const idsDocs = notas.flatMap((n) => [n.documento_id, n.danfse_documento_id]).filter((x): x is string => Boolean(x));
  const idsNotas = notas.map((n) => n.id);
  const [docsDasNotas, eventos, numerosDoSistema] = await Promise.all([
    porIds<Guardado>(idsDocs, (l) => db.from("documento").select("id, storage_path, sha256").eq("empresa_id", empresaId).in("id", l)),
    porIds<EventoGuardado>(idsNotas, (l) => db.from("documento").select("id, storage_path, sha256, nota_id").eq("empresa_id", empresaId).eq("tipo", "xml_evento").in("nota_id", l).order("criado_em")),
    // números de todas as notas do sistema (de qualquer mês): a importada repetida sai uma vez só
    todas<{ empresa_id: string; numero_nfse: string | null }>((a, b) => db.from("nota").select("empresa_id, numero_nfse").eq("empresa_id", empresaId).not("numero_nfse", "is", null).range(a, b)),
  ]);

  return { notas, importadas, docsDasNotas, eventos, numerosDoSistema };
}
