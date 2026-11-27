import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModeloNota } from "@/lib/nfse/nfse-parser";

export type OrigemCadastro = "nota" | "xml" | "adn";
export type Aprendido = { tomador: "novo" | "existente" | "sem"; servico: "novo" | "existente" | "sem" };

const limpa = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Cadastros a partir de uma NFS-e importada (XML enviado ou ADN): só quando a empresa é a PRESTADORA da nota
 * (notas recebidas trazem a empresa como tomadora e não servem de cadastro). Nunca sobrescreve o que já existe:
 * o cadastro editado pelo escritório vale mais que o XML.
 */
export async function aprenderDaNfse(db: SupabaseClient, empresa: { id: string; cnpj: string }, m: ModeloNota, origem: OrigemCadastro): Promise<Aprendido> {
  if (!m.prestadorCnpj || m.prestadorCnpj !== empresa.cnpj) return { tomador: "sem", servico: "sem" };
  const r: Aprendido = { tomador: "sem", servico: "sem" };

  const t = m.tomador;
  if (t && t.documento && t.tipoDocumento !== "EXTERIOR") {
    const ins = await db.from("tomador").upsert(
      {
        empresa_id: empresa.id,
        tipo_documento: t.tipoDocumento,
        documento: t.documento,
        nome: limpa(t.nome),
        email: t.email,
        cep: t.endereco?.cep ?? null,
        cod_municipio: t.endereco?.codMunicipio ?? null,
        logradouro: t.endereco?.logradouro ?? null,
        numero: t.endereco?.numero ?? null,
        complemento: t.endereco?.complemento ?? null,
        bairro: t.endereco?.bairro ?? null,
        origem,
      },
      { onConflict: "empresa_id,tipo_documento,documento", ignoreDuplicates: true },
    ).select("id");
    if (ins.error) throw new Error(`tomador: ${ins.error.message}`);
    r.tomador = (ins.data ?? []).length > 0 ? "novo" : "existente";
  }

  r.servico = await guardarServico(db, empresa.id, {
    codigo_tributacao_nacional: m.servico.codigoTributacaoNacional,
    codigo_nbs: m.servico.codigoNbs,
    descricao: m.servico.descricao,
    cod_municipio_prestacao: m.servico.codMunicipioPrestacao,
    iss_retido: m.issRetido,
    aliquota_iss: m.issRetido && m.aliquotaIss ? m.aliquotaIss : null,
    origem,
  });
  return r;
}

export type ServicoNovo = {
  codigo_tributacao_nacional: string;
  codigo_nbs: string | null;
  descricao: string;
  cod_municipio_prestacao: string | null;
  iss_retido: boolean;
  aliquota_iss: string | null;
  valor_padrao?: string | null;
  nome?: string | null;
  pct_ret_inss?: string | null;
  pct_ret_irrf?: string | null;
  pct_ret_csll?: string | null;
  pct_ret_pis?: string | null;
  pct_ret_cofins?: string | null;
  cclasstrib?: string | null;
  cind_op?: string | null;
  cativ_sn?: string | null;
  origem: OrigemCadastro | "manual";
};

/** Insere o serviço se ainda não houver um com o mesmo código e descrição na empresa (índice servico_unico). */
export async function guardarServico(db: SupabaseClient, empresaId: string, s: ServicoNovo): Promise<"novo" | "existente"> {
  const descricao = s.descricao.trim();
  const { data: ja } = await db.from("servico").select("id, descricao").eq("empresa_id", empresaId)
    .eq("codigo_tributacao_nacional", s.codigo_tributacao_nacional);
  if ((ja ?? []).some((x) => String(x.descricao).trim().toLowerCase() === descricao.toLowerCase())) return "existente";
  const ins = await db.from("servico").insert({ empresa_id: empresaId, ...s, descricao, codigo_nbs: s.codigo_nbs || null, nome: s.nome || null, valor_padrao: s.valor_padrao || null });
  if (ins.error?.code === "23505") return "existente";
  if (ins.error) throw new Error(`serviço: ${ins.error.message}`);
  return "novo";
}
