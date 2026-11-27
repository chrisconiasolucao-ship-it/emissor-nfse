"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Estado } from "@/app/(app)/notas/actions";
import { exigir, podeEmitir } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { guardarServico } from "@/lib/cadastros/aprender";
import { cnpjValido, cpfValido } from "@/lib/importacao/planilha";
import { codigoServico, documento } from "@/lib/formato";
import { lerValor, reais } from "@/lib/money";
import { lerPercentual } from "@/lib/nfse/retencoes";
import { supabaseServidor } from "@/lib/supabase/server";

const opc = (max = 255) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const idOpc = z.uuid().optional().or(z.literal("").transform(() => undefined));
const decimal = (rotulo: string) =>
  opc(30).refine((v) => {
    if (!v) return true;
    try {
      return lerValor(v).greaterThan(0);
    } catch {
      return false;
    }
  }, `${rotulo} inválido`);

/* ---------- Tomadores ---------- */

const tomadorSchema = z
  .object({
    id: idOpc,
    empresa_id: z.uuid(),
    tipo_documento: z.enum(["CPF", "CNPJ"]),
    documento: z.string().trim().max(20).transform((v) => v.replace(/\D/g, "")),
    nome: z.string().trim().min(1, "informe o nome").max(300),
    email: opc(),
    telefone: opc(30),
    cep: opc(9).transform((v) => (v ? v.replace(/\D/g, "") : null)),
    cod_municipio: opc(7),
    logradouro: opc(),
    numero: opc(60),
    complemento: opc(),
    bairro: opc(),
  })
  .refine((d) => (d.tipo_documento === "CPF" ? cpfValido(d.documento) : cnpjValido(d.documento)), { message: "CPF/CNPJ inválido", path: ["documento"] })
  .refine((d) => !d.cep || /^\d{8}$/.test(d.cep), { message: "CEP com 8 dígitos", path: ["cep"] });

export async function salvarTomador(_: Estado, form: FormData): Promise<Estado> {
  const perfil = await perfilAtual();
  const r = tomadorSchema.safeParse(Object.fromEntries(form));
  if (!r.success) return { erro: r.error.issues.map((i) => i.message).join("; ") };
  const { id, ...d } = r.data;
  exigir(podeEmitir(perfil, d.empresa_id));
  const db = await supabaseServidor();
  const q = id
    ? db.from("tomador").update(d).eq("empresa_id", d.empresa_id).eq("id", id)
    : db.from("tomador").insert({ ...d, origem: "manual" });
  const { error } = await q;
  if (error?.code === "23505") return { erro: "Já existe um tomador com este CPF/CNPJ nesta empresa." };
  if (error) return { erro: error.message };
  revalidatePath("/tomadores");
  revalidatePath("/servicos");
  return { ok: true, mensagem: id ? "Tomador atualizado." : "Tomador cadastrado." };
}

export async function excluirTomador(_: Estado, form: FormData): Promise<Estado> {
  const perfil = await perfilAtual();
  const empresaId = String(form.get("empresa_id"));
  exigir(podeEmitir(perfil, empresaId));
  const db = await supabaseServidor();
  const { error } = await db.from("tomador").delete().eq("empresa_id", empresaId).eq("id", String(form.get("id")));
  // tomador com nota fica: a nota guarda a referência (chave estrangeira)
  if (error?.code === "23503") return { erro: "Este tomador já tem notas e não pode ser excluído. Você pode editar os dados dele." };
  if (error) return { erro: error.message };
  revalidatePath("/tomadores");
  revalidatePath("/servicos");
  return { ok: true, mensagem: "Tomador excluído." };
}

/* ---------- Serviços ---------- */

const pctOpc = z
  .string()
  .trim()
  .max(10)
  .optional()
  .refine((v) => {
    try {
      lerPercentual(v);
      return true;
    } catch {
      return false;
    }
  }, "percentual de retenção precisa ser maior que 0, menor que 100 e ter até 2 casas")
  .transform((v) => lerPercentual(v));

const servicoSchema = z
  .object({
    id: idOpc,
    empresa_id: z.uuid(),
    nome: opc(120),
    codigo_tributacao_nacional: z.string().trim().regex(/^\d{6}$/, "escolha o código de tributação na lista"),
    codigo_nbs: opc(9),
    descricao: z.string().trim().min(1, "informe a descrição").max(2000),
    cod_municipio_prestacao: opc(7),
    valor_padrao: decimal("valor"),
    iss_retido: z.string().optional().transform((v) => v === "on" || v === "true"),
    aliquota_iss: decimal("alíquota"),
    ret_inss: pctOpc,
    ret_irrf: pctOpc,
    ret_csll: pctOpc,
    ret_pis: pctOpc,
    ret_cofins: pctOpc,
  })
  .refine((d) => !d.iss_retido || !!d.aliquota_iss, { message: "ISS retido exige alíquota", path: ["aliquota_iss"] });

export async function salvarServico(_: Estado, form: FormData): Promise<Estado> {
  const perfil = await perfilAtual();
  const r = servicoSchema.safeParse(Object.fromEntries(form));
  if (!r.success) return { erro: r.error.issues.map((i) => i.message).join("; ") };
  const { id, ret_inss, ret_irrf, ret_csll, ret_pis, ret_cofins, ...d } = r.data;
  exigir(podeEmitir(perfil, d.empresa_id));
  const linha = {
    ...d,
    pct_ret_inss: ret_inss,
    pct_ret_irrf: ret_irrf,
    pct_ret_csll: ret_csll,
    pct_ret_pis: ret_pis,
    pct_ret_cofins: ret_cofins,
    valor_padrao: d.valor_padrao ? lerValor(d.valor_padrao).toFixed(2) : null,
    aliquota_iss: d.aliquota_iss ? lerValor(d.aliquota_iss).toFixed(2) : null,
  };
  const db = await supabaseServidor();
  if (id) {
    const { error } = await db.from("servico").update(linha).eq("empresa_id", d.empresa_id).eq("id", id);
    if (error?.code === "23505") return { erro: "Já existe um serviço com este código e esta descrição." };
    if (error) return { erro: error.message };
  } else {
    try {
      const res = await guardarServico(db, d.empresa_id, { ...linha, origem: "manual" });
      if (res === "existente") return { erro: "Já existe um serviço com este código e esta descrição." };
    } catch (e) {
      return { erro: e instanceof Error ? e.message : String(e) };
    }
  }
  revalidatePath("/tomadores");
  revalidatePath("/servicos");
  return { ok: true, mensagem: id ? "Serviço atualizado." : "Serviço cadastrado." };
}

/** Serviço sai da lista (ativo = false); notas antigas continuam apontando para ele. */
export async function arquivarServico(_: Estado, form: FormData): Promise<Estado> {
  const perfil = await perfilAtual();
  const empresaId = String(form.get("empresa_id"));
  exigir(podeEmitir(perfil, empresaId));
  const ativo = form.get("ativo") === "true";
  const db = await supabaseServidor();
  const { error } = await db.from("servico").update({ ativo }).eq("empresa_id", empresaId).eq("id", String(form.get("id")));
  if (error) return { erro: error.message };
  revalidatePath("/tomadores");
  revalidatePath("/servicos");
  return { ok: true, mensagem: ativo ? "Serviço reativado." : "Serviço arquivado." };
}

/* ---------- Busca para a nova nota ---------- */

export type OpcaoCadastro = {
  id: string;
  /** Texto de uma linha (nome · documento), usado em campos de busca simples. */
  rotulo: string;
  /** Linha principal da lista (nome do tomador ou do serviço). */
  titulo?: string;
  /** Linha de baixo (CPF/CNPJ, valor padrão). */
  detalhe?: string;
  /** Código de tributação formatado (só serviços). */
  codigo?: string;
  /** De onde veio o cadastro: manual, nota, planilha, xml, adn. */
  origem?: string;
};

const termoLimpo = (t: string) => String(t ?? "").trim().replace(/[%_,()*]/g, "");

export async function buscarTomadores(empresaId: string, termo: string): Promise<OpcaoCadastro[]> {
  if (!z.uuid().safeParse(empresaId).success) return [];
  const t = termoLimpo(termo);
  const db = await supabaseServidor();
  let q = db.from("tomador").select("id, nome, tipo_documento, documento, origem").eq("empresa_id", empresaId).order("nome").limit(30);
  if (t) {
    const dig = t.replace(/\D/g, "");
    q = dig.length >= 3 && dig.length === t.replace(/[.\-/\s]/g, "").length ? q.like("documento", `%${dig}%`) : q.ilike("nome", `%${t}%`);
  }
  const { data } = await q;
  return (data ?? []).map((x) => {
    const doc = `${x.tipo_documento} ${documento(x.documento)}`;
    return { id: String(x.id), rotulo: `${x.nome} · ${doc}`, titulo: x.nome, detalhe: doc, origem: x.origem };
  });
}

export async function buscarServicos(empresaId: string, termo: string): Promise<OpcaoCadastro[]> {
  if (!z.uuid().safeParse(empresaId).success) return [];
  const t = termoLimpo(termo);
  const db = await supabaseServidor();
  let q = db.from("servico").select("id, nome, descricao, codigo_tributacao_nacional, valor_padrao, origem").eq("empresa_id", empresaId).eq("ativo", true).order("nome", { nullsFirst: false }).limit(30);
  // código com ou sem pontos (01.07 ou 0107) busca pelo começo do código; o resto busca no nome e na descrição
  if (t) q = /^[\d.\s]+$/.test(t) ? q.like("codigo_tributacao_nacional", `${t.replace(/\D/g, "")}%`) : q.or(`nome.ilike.%${t}%,descricao.ilike.%${t}%`);
  const { data } = await q;
  return (data ?? []).map((x) => {
    const desc = String(x.descricao).slice(0, 90);
    return {
      id: String(x.id),
      rotulo: `${x.nome ? `${x.nome} · ` : ""}${x.codigo_tributacao_nacional} · ${desc.slice(0, 70)}`,
      titulo: x.nome || desc,
      detalhe: x.valor_padrao != null ? `valor padrão ${reais(x.valor_padrao)}` : "sem valor padrão",
      codigo: codigoServico(x.codigo_tributacao_nacional),
      origem: x.origem,
    };
  });
}
