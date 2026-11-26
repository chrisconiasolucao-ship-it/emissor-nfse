"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Estado } from "@/app/(app)/notas/actions";
import { exigir, podeEmitir } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { guardarServico } from "@/lib/cadastros/aprender";
import { cnpjValido, cpfValido } from "@/lib/importacao/planilha";
import { lerValor } from "@/lib/money";
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
  revalidatePath("/cadastros");
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
  revalidatePath("/cadastros");
  return { ok: true, mensagem: "Tomador excluído." };
}

/* ---------- Serviços ---------- */

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
  })
  .refine((d) => !d.iss_retido || !!d.aliquota_iss, { message: "ISS retido exige alíquota", path: ["aliquota_iss"] });

export async function salvarServico(_: Estado, form: FormData): Promise<Estado> {
  const perfil = await perfilAtual();
  const r = servicoSchema.safeParse(Object.fromEntries(form));
  if (!r.success) return { erro: r.error.issues.map((i) => i.message).join("; ") };
  const { id, ...d } = r.data;
  exigir(podeEmitir(perfil, d.empresa_id));
  const linha = {
    ...d,
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
  revalidatePath("/cadastros");
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
  revalidatePath("/cadastros");
  return { ok: true, mensagem: ativo ? "Serviço reativado." : "Serviço arquivado." };
}

/* ---------- Busca para a nova nota ---------- */

export type OpcaoCadastro = { id: string; rotulo: string };

const termoLimpo = (t: string) => String(t ?? "").trim().replace(/[%_,()*]/g, "");

export async function buscarTomadores(empresaId: string, termo: string): Promise<OpcaoCadastro[]> {
  if (!z.uuid().safeParse(empresaId).success) return [];
  const t = termoLimpo(termo);
  const db = await supabaseServidor();
  let q = db.from("tomador").select("id, nome, tipo_documento, documento").eq("empresa_id", empresaId).order("nome").limit(20);
  if (t) {
    const dig = t.replace(/\D/g, "");
    q = dig.length >= 3 && dig.length === t.replace(/[.\-/\s]/g, "").length ? q.like("documento", `${dig}%`) : q.ilike("nome", `%${t}%`);
  }
  const { data } = await q;
  return (data ?? []).map((x) => ({ id: String(x.id), rotulo: `${x.nome} · ${x.tipo_documento} ${x.documento}` }));
}

export async function buscarServicos(empresaId: string, termo: string): Promise<OpcaoCadastro[]> {
  if (!z.uuid().safeParse(empresaId).success) return [];
  const t = termoLimpo(termo);
  const db = await supabaseServidor();
  let q = db.from("servico").select("id, nome, descricao, codigo_tributacao_nacional").eq("empresa_id", empresaId).eq("ativo", true).order("nome", { nullsFirst: false }).limit(20);
  if (t) q = /^\d+$/.test(t) ? q.like("codigo_tributacao_nacional", `${t}%`) : q.or(`nome.ilike.%${t}%,descricao.ilike.%${t}%`);
  const { data } = await q;
  return (data ?? []).map((x) => ({ id: String(x.id), rotulo: `${x.nome ? `${x.nome} · ` : ""}${x.codigo_tributacao_nacional} · ${String(x.descricao).slice(0, 70)}` }));
}
