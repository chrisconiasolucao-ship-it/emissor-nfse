"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigir, podeVer } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { config } from "@/lib/config";
import { arquivosDaNota, baixarConferido, dadosDaNota, lerNotaParaEnvio } from "@/lib/envio/arquivos";
import { lerEmails, montarEmail, remetente, telefoneWhatsApp } from "@/lib/envio/mensagens";
import { enviarPorSmtp, FalhaNoEnvio } from "@/lib/envio/smtp";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServidor } from "@/lib/supabase/server";
import type { Estado } from "./actions";

const emailSchema = z.object({
  id: z.uuid(),
  para: z.string().trim().max(700),
  mensagem: z.string().trim().max(1000).optional(),
});

/** Guarda no cadastro do tomador o e-mail/telefone digitado, só se o cadastro estiver vazio. */
async function completarTomador(notaId: string, empresaId: string, campo: "email" | "telefone", valor: string) {
  const admin = supabaseAdmin();
  const { data: n } = await admin.from("nota").select("tomador_id").eq("empresa_id", empresaId).eq("id", notaId).maybeSingle();
  if (!n?.tomador_id) return;
  await admin.from("tomador").update({ [campo]: valor }).eq("empresa_id", empresaId).eq("id", n.tomador_id).is(campo, null);
}

/** Envia o DANFSe e o XML por e-mail pelo Gmail do escritório (SMTP). */
export async function enviarNotaPorEmail(_: Estado, form: FormData): Promise<Estado> {
  const p = emailSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { erro: "Dados do envio inválidos." };
  const perfil = await perfilAtual();
  const nota = await lerNotaParaEnvio(await supabaseServidor(), p.data.id); // RLS: só vê a nota quem pode
  if (!nota) return { erro: "Nota não encontrada." };
  exigir(podeVer(perfil, nota.empresa_id));
  if (nota.situacao !== "autorizada") return { erro: "Só nota autorizada pode ser enviada ao tomador." };

  const lidos = lerEmails(p.data.para);
  if ("erro" in lidos) return { erro: lidos.erro };

  const c = config();
  if (!c.SMTP_USUARIO || !c.SMTP_SENHA) {
    return { erro: "O envio por e-mail ainda não foi configurado: falta cadastrar SMTP_USUARIO e SMTP_SENHA (senha de app do Gmail) na Vercel." };
  }

  const admin = supabaseAdmin();
  const registrar = (situacao: "enviado" | "falhou", extra: { provedor_id?: string; erro?: string }) =>
    admin.from("envio_nota").insert({ empresa_id: nota.empresa_id, nota_id: nota.id, canal: "email", destinatario: lidos.emails.join(", "), situacao, criado_por: perfil.usuarioId, ...extra });

  try {
    const arquivos = await arquivosDaNota(admin, nota);
    if (!arquivos.some((a) => a.tipo === "danfse")) return { erro: "O DANFSe desta nota ainda não foi gerado. Aguarde alguns instantes e tente de novo." };
    const anexos = await Promise.all(
      arquivos.map(async (a) => ({ nome: a.nome, conteudo: await baixarConferido(admin, a), tipo: a.tipo === "danfse" ? "application/pdf" : "application/xml" })),
    );
    const { assunto, html, texto } = montarEmail(dadosDaNota(nota), p.data.mensagem);
    const id = await enviarPorSmtp(
      { host: c.SMTP_HOST, porta: c.SMTP_PORTA, usuario: c.SMTP_USUARIO, senha: c.SMTP_SENHA },
      { de: remetente(nota.empresa.razao_social, c.SMTP_USUARIO), para: lidos.emails, responderPara: nota.empresa.email || c.EMAIL_ESCRITORIO || null, assunto, html, texto, anexos },
    );
    await registrar("enviado", { provedor_id: id || undefined });
  } catch (e) {
    const msg = e instanceof FalhaNoEnvio ? e.message : `O e-mail não foi enviado: ${(e as Error).message}`;
    await registrar("falhou", { erro: msg.slice(0, 500) });
    revalidatePath(`/notas/${nota.id}`);
    return { erro: msg };
  }
  if (lidos.emails.length === 1) await completarTomador(nota.id, nota.empresa_id, "email", lidos.emails[0]!);
  revalidatePath(`/notas/${nota.id}`);
  return { ok: true, mensagem: `E-mail enviado para ${lidos.emails.join(", ")} com o PDF e o XML.` };
}

/** Registra que o WhatsApp foi aberto com o link da nota (não dá para saber se a pessoa apertou enviar). */
export async function registrarWhatsApp(id: string, telefone: string): Promise<void> {
  const tel = telefoneWhatsApp(telefone);
  if (!z.uuid().safeParse(id).success || !tel) return;
  const perfil = await perfilAtual();
  const nota = await lerNotaParaEnvio(await supabaseServidor(), id);
  if (!nota || !podeVer(perfil, nota.empresa_id)) return;
  await supabaseAdmin().from("envio_nota").insert({ empresa_id: nota.empresa_id, nota_id: nota.id, canal: "whatsapp", destinatario: tel, situacao: "link_aberto", criado_por: perfil.usuarioId });
  await completarTomador(nota.id, nota.empresa_id, "telefone", telefone.trim());
  revalidatePath(`/notas/${nota.id}`);
}
