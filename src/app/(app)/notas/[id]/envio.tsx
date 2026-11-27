import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { EnviarNota, type EnvioFeito } from "@/components/enviar-nota";
import { baseUrl, dadosDaNota, lerNotaComErro, segredoDoLink } from "@/lib/envio/arquivos";
import { criarToken, DIAS_LINK } from "@/lib/envio/link";
import { textoWhatsApp } from "@/lib/envio/mensagens";
import { supabaseServidor } from "@/lib/supabase/server";

const quando = (d: string) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/** Cartão "Enviar ao tomador" da nota autorizada, com o histórico de envios e o que o tomador fez com cada um. */
export async function EnvioDaNota({ notaId }: { notaId: string }) {
  const db = await supabaseServidor();
  const { nota, erro } = await lerNotaComErro(db, notaId);
  if (!nota) return <div className="msg erro">O envio ao tomador não pôde ser carregado{erro ? `: ${erro}` : "."}</div>;
  if (nota.situacao !== "autorizada") return null;
  const [{ data: envios }, { data: acessos }] = await Promise.all([
    db.from("envio_nota").select("id, canal, destinatario, situacao, erro, criado_em").eq("empresa_id", nota.empresa_id).eq("nota_id", notaId).order("criado_em", { ascending: false }).limit(20),
    db.from("envio_acesso").select("envio_id, tipo, criado_em").eq("empresa_id", nota.empresa_id).eq("nota_id", notaId).order("criado_em", { ascending: true }).limit(500),
  ]);
  // o próximo envio por WhatsApp já nasce com id, que vai dentro do link
  const envioWhatsApp = randomUUID();
  const link = `${baseUrl(await headers())}/n/${criarToken(nota.id, await segredoDoLink(), new Date(), DIAS_LINK, envioWhatsApp)}`;
  const lista: EnvioFeito[] = (envios ?? []).map((e) => {
    const deste = (acessos ?? []).filter((a) => a.envio_id === e.id);
    const resumo = (tipo: string) => {
      const v = deste.filter((a) => a.tipo === tipo);
      return v.length ? { primeiro: quando(v[0]!.criado_em), vezes: v.length } : null;
    };
    return {
      canal: e.canal, destinatario: e.destinatario, situacao: e.situacao, erro: e.erro, quando: quando(e.criado_em),
      abriuEmail: resumo("abriu_email"), abriuLink: resumo("abriu_link"), baixouPdf: resumo("baixou_danfse"), baixouXml: resumo("baixou_xml"),
    };
  });
  return (
    <EnviarNota
      notaId={nota.id}
      envioWhatsApp={envioWhatsApp}
      email={nota.tomador?.email ?? null}
      telefone={nota.tomador?.telefone ?? null}
      textoWhatsApp={textoWhatsApp(dadosDaNota(nota), link, DIAS_LINK)}
      envios={lista}
    />
  );
}
