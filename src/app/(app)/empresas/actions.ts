"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auditar, ipDe, logSeguranca } from "@/lib/auditoria/audit";
import { exigir, podeCriarUsuario, podeGerirCertificado, podeGerirEmpresas, type Papel } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { config } from "@/lib/config";
import { chaveMestra, cifrarArquivo, cifrarTexto } from "@/lib/crypto/cert-vault";
import { abrirPfx, CertificadoVencido, exigirValido, SenhaCertificadoInvalida, type CertificadoAberto } from "@/lib/crypto/pfx";
import { consultarCnpj, EmpresaForaDoEscopo, sugerirEmpresa, type EmpresaSugerida } from "@/lib/empresa/consulta-cnpj";
import { cnpjValido } from "@/lib/importacao/planilha";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServidor } from "@/lib/supabase/server";
import type { Estado } from "../notas/actions";

const empresaSchema = z.object({
  id: z.uuid().optional().or(z.literal("").transform(() => undefined)),
  cnpj: z.string().transform((v) => v.replace(/\D/g, "")).refine(cnpjValido, "CNPJ inválido"),
  razao_social: z.string().trim().min(1, "informe a razão social").max(300),
  nome_fantasia: z.string().trim().max(300).optional().transform((v) => v || null),
  // AT-024: só Simples Nacional (ME/EPP) e MEI
  regime: z.enum(["ME", "EPP", "MEI"], { message: "a 1ª versão emite só para Simples Nacional (ME/EPP) e MEI" }),
  inscricao_municipal: z.string().trim().max(30).optional().transform((v) => v || null),
  cod_municipio: z.string().regex(/^\d{7}$/, "escolha o município na lista"),
  email: z.string().trim().max(200).optional().transform((v) => v || null),
  telefone: z.string().trim().max(30).optional().transform((v) => v || null),
  serie_dps: z.string().regex(/^\d{1,5}$/, "série com até 5 dígitos").default("90001"),
});

export async function salvarEmpresa(_: Estado, form: FormData): Promise<Estado> {
  const perfil = await perfilAtual();
  exigir(podeGerirEmpresas(perfil));
  const r = empresaSchema.safeParse(Object.fromEntries(form));
  if (!r.success) return { erro: r.error.issues.map((i) => i.message).join("; ") };
  const { id, ...campos } = r.data;
  const db = await supabaseServidor();
  if (id) {
    const { error } = await db.from("empresa").update(campos).eq("id", id);
    if (error) return { erro: error.message };
    revalidatePath(`/empresas/${id}`);
    return { ok: true, mensagem: "Empresa atualizada." };
  }
  const { data, error } = await db.from("empresa").insert(campos).select("id").single();
  if (error) return { erro: error.code === "23505" ? "Já existe empresa com este CNPJ." : error.message };
  redirect(`/empresas/${data.id}`);
}

type Perfil = Awaited<ReturnType<typeof perfilAtual>>;

async function lerPfx(form: FormData): Promise<{ pfx: Buffer; senha: string } | { erro: string }> {
  const senha = String(form.get("senha") ?? "");
  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0 || arquivo.size > 64 * 1024) return { erro: "Escolha o arquivo .pfx (A1) do certificado." };
  return { pfx: Buffer.from(await arquivo.arrayBuffer()), senha };
}

function abrirValido(pfx: Buffer, senha: string): CertificadoAberto | { erro: string } {
  try {
    return exigirValido(abrirPfx(pfx, senha));
  } catch (e) {
    if (e instanceof SenhaCertificadoInvalida) return { erro: "A senha não abre este certificado." };
    if (e instanceof CertificadoVencido) return { erro: `Certificado vencido: ${e.message}.` };
    throw e;
  }
}

/** Guarda o pfx cifrado (AT-013), desativa o anterior e registra trilha e log de segurança. */
async function guardarCertificado(empresaId: string, pfx: Buffer, senha: string, aberto: CertificadoAberto, perfil: Perfil): Promise<{ erro?: string }> {
  const admin = supabaseAdmin();
  const c = config();
  const chave = chaveMestra(c.CERT_MASTER_KEY);
  const { arquivo: cifrado, meta } = cifrarArquivo(pfx, chave, c.CERT_KEY_VERSION);
  const senhaCripto = cifrarTexto(senha, chave, c.CERT_KEY_VERSION);
  const caminho = `${empresaId}/${aberto.sha256}.pfx.enc`;
  const up = await admin.storage.from("certificados").upload(caminho, cifrado, { contentType: "application/octet-stream", upsert: true });
  if (up.error) return { erro: `Storage: ${up.error.message}` };

  await admin.from("certificado").update({ ativo: false }).eq("empresa_id", empresaId).eq("ativo", true);
  const { data: novo, error } = await admin
    .from("certificado")
    .insert({
      empresa_id: empresaId,
      storage_path: caminho,
      pfx_cripto: meta,
      senha_cripto: senhaCripto,
      sha256: aberto.sha256,
      titular: aberto.titular,
      cnpj_titular: aberto.cnpjTitular,
      valido_de: aberto.validoDe.toISOString(),
      valido_ate: aberto.validoAte.toISOString(),
      enviado_por: perfil.usuarioId,
    })
    .select("id")
    .single();
  if (error) return { erro: error.message };
  const ip = ipDe(await headers());
  await logSeguranca(admin, { evento: "envio_certificado", usuarioId: perfil.usuarioId, email: perfil.email, ip, empresaId, alvo: `certificado:${novo.id}`, detalhe: { titular: aberto.titular, valido_ate: aberto.validoAte.toISOString() } });
  await auditar(admin, { empresaId, acao: "envio_certificado", entidade: "certificado", entidadeId: String(novo.id), depois: { titular: aberto.titular, sha256: aberto.sha256, valido_ate: aberto.validoAte.toISOString() }, quem: perfil.usuarioId, ip });
  return {};
}

/** Envio do pfx (AT-011, AT-013): abre com a senha, confere validade e CNPJ, guarda cifrado. */
export async function enviarCertificado(_: Estado, form: FormData): Promise<Estado> {
  const perfil = await perfilAtual();
  exigir(podeGerirCertificado(perfil), "Só o escritório envia certificado.");
  const empresaId = z.uuid().parse(form.get("empresa_id"));
  const lido = await lerPfx(form);
  if ("erro" in lido) return lido;
  const aberto = abrirValido(lido.pfx, lido.senha);
  if ("erro" in aberto) return aberto;
  const { data: emp } = await supabaseAdmin().from("empresa").select("cnpj").eq("id", empresaId).single();
  if (!emp) return { erro: "Empresa não encontrada." };
  if (aberto.cnpjTitular && aberto.cnpjTitular.slice(0, 8) !== String(emp.cnpj).slice(0, 8)) {
    return { erro: `O certificado é do CNPJ ${aberto.cnpjTitular}, não desta empresa.` };
  }
  const g = await guardarCertificado(empresaId, lido.pfx, lido.senha, aberto, perfil);
  if (g.erro) return { erro: g.erro };
  revalidatePath(`/empresas/${empresaId}`);
  return { ok: true, mensagem: `Certificado de ${aberto.titular} guardado, válido até ${aberto.validoAte.toLocaleDateString("pt-BR")}.` };
}

export type SugestaoCadastro = EmpresaSugerida & { titular: string; validoAte: string };

/** Cadastro pelo certificado, etapa 1: lê o A1 e consulta o CNPJ; nada é gravado. */
export async function lerCertificadoParaCadastro(form: FormData): Promise<{ erro: string } | { sugestao: SugestaoCadastro }> {
  const perfil = await perfilAtual();
  exigir(podeGerirEmpresas(perfil) && podeGerirCertificado(perfil), "Só o escritório cadastra empresa.");
  const lido = await lerPfx(form);
  if ("erro" in lido) return lido;
  const aberto = abrirValido(lido.pfx, lido.senha);
  if ("erro" in aberto) return aberto;
  if (!aberto.cnpjTitular || !cnpjValido(aberto.cnpjTitular)) {
    return { erro: "Este certificado não traz CNPJ (é de pessoa física?). Use um e-CNPJ A1 da empresa." };
  }
  try {
    const s = sugerirEmpresa(aberto.cnpjTitular, aberto.titular, await consultarCnpj(aberto.cnpjTitular));
    return { sugestao: { ...s, titular: aberto.titular, validoAte: aberto.validoAte.toISOString() } };
  } catch (e) {
    if (e instanceof EmpresaForaDoEscopo) return { erro: e.message };
    // consulta fora do ar: segue só com o que o certificado traz
    return { sugestao: { cnpj: aberto.cnpjTitular, razao_social: aberto.titular, nome_fantasia: null, regime: null, cod_municipio: null,
      municipio: "", email: null, telefone: null, titular: aberto.titular, validoAte: aberto.validoAte.toISOString(),
      avisos: [`${e instanceof Error ? e.message : String(e)} Preencha regime e município.`] } };
  }
}

/**
 * Cadastro pelo certificado, etapa 2: o usuário conferiu os dados. Abre o A1 de novo (o CNPJ gravado é sempre
 * o do certificado), cria a empresa e guarda o certificado.
 */
export async function cadastrarPeloCertificado(form: FormData): Promise<{ erro: string } | { id: string }> {
  const perfil = await perfilAtual();
  exigir(podeGerirEmpresas(perfil) && podeGerirCertificado(perfil), "Só o escritório cadastra empresa.");
  const lido = await lerPfx(form);
  if ("erro" in lido) return lido;
  const aberto = abrirValido(lido.pfx, lido.senha);
  if ("erro" in aberto) return aberto;
  if (!aberto.cnpjTitular) return { erro: "Este certificado não traz CNPJ." };
  const campos = Object.fromEntries([...form.entries()].filter(([k]) => !["arquivo", "senha"].includes(k)));
  const r = empresaSchema.safeParse({ ...campos, cnpj: aberto.cnpjTitular, id: "" });
  if (!r.success) return { erro: r.error.issues.map((i) => i.message).join("; ") };
  const { id, ...dados } = r.data;
  void id;
  const db = await supabaseServidor(); // RLS: só escritório cria empresa
  const { data, error } = await db.from("empresa").insert(dados).select("id").single();
  if (error) return { erro: error.code === "23505" ? `Já existe empresa com o CNPJ ${dados.cnpj}.` : error.message };
  const g = await guardarCertificado(data.id, lido.pfx, lido.senha, aberto, perfil);
  if (g.erro) return { erro: `Empresa criada, mas o certificado não foi guardado: ${g.erro}. Envie de novo na página da empresa.` };
  revalidatePath("/empresas");
  return { id: data.id };
}

const usuarioSchema = z.object({
  empresa_id: z.uuid().optional().or(z.literal("").transform(() => undefined)),
  nome: z.string().trim().min(1).max(200),
  email: z.email(),
  papel: z.enum(["escritorio_admin", "escritorio_operador", "cliente_admin", "cliente_usuario"]),
});

/** AT-026: admin do cliente cria usuário só na própria empresa, com papel de cliente. */
export async function criarUsuario(_: Estado, form: FormData): Promise<Estado> {
  const perfil = await perfilAtual();
  const r = usuarioSchema.safeParse(Object.fromEntries(form));
  if (!r.success) return { erro: r.error.issues.map((i) => i.message).join("; ") };
  const d = r.data;
  const empresaId = d.papel.startsWith("cliente") ? (d.empresa_id ?? null) : null;
  if (!podeCriarUsuario(perfil, empresaId, d.papel as Papel)) return { erro: "Você não pode criar este usuário." };
  const admin = supabaseAdmin();
  const senhaInicial = randomBytes(12).toString("base64url");
  const { data: u, error } = await admin.auth.admin.createUser({ email: d.email, password: senhaInicial, email_confirm: true, user_metadata: { nome: d.nome } });
  if (error || !u.user) return { erro: error?.message ?? "não criou o usuário" };
  const p = await admin.from("perfil_usuario").insert({ usuario_id: u.user.id, empresa_id: empresaId, papel: d.papel, nome: d.nome, email: d.email });
  if (p.error) {
    await admin.auth.admin.deleteUser(u.user.id);
    return { erro: p.error.message };
  }
  await auditar(admin, { empresaId, acao: "criar_usuario", entidade: "perfil_usuario", entidadeId: u.user.id, depois: { email: d.email, papel: d.papel }, quem: perfil.usuarioId });
  revalidatePath(empresaId ? `/empresas/${empresaId}` : "/empresas");
  return { ok: true, mensagem: `Usuário criado. Senha inicial (mostrada só agora): ${senhaInicial}` };
}

export async function retomarEmpresa(form: FormData): Promise<void> {
  const perfil = await perfilAtual();
  exigir(podeGerirEmpresas(perfil));
  const empresaId = z.uuid().parse(form.get("empresa_id"));
  await supabaseAdmin().rpc("fn_retomar_empresa", { p_empresa_id: empresaId, p_quem: perfil.usuarioId });
  revalidatePath(`/empresas/${empresaId}`);
}
