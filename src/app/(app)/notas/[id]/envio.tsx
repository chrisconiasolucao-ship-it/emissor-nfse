import { headers } from "next/headers";
import { EnviarNota } from "@/components/enviar-nota";
import { baseUrl, dadosDaNota, lerNotaComErro, segredoDoLink } from "@/lib/envio/arquivos";
import { criarToken, DIAS_LINK } from "@/lib/envio/link";
import { textoWhatsApp } from "@/lib/envio/mensagens";
import { supabaseServidor } from "@/lib/supabase/server";

/** Cartão "Enviar ao tomador" da nota autorizada, com o histórico de envios. */
export async function EnvioDaNota({ notaId }: { notaId: string }) {
  const db = await supabaseServidor();
  const { nota, erro } = await lerNotaComErro(db, notaId);
  if (!nota) return <div className="msg erro">O envio ao tomador não pôde ser carregado{erro ? `: ${erro}` : "."}</div>;
  if (nota.situacao !== "autorizada") return null;
  const { data: envios } = await db.from("envio_nota").select("canal, destinatario, situacao, erro, criado_em").eq("empresa_id", nota.empresa_id).eq("nota_id", notaId).order("criado_em", { ascending: false }).limit(10);
  const link = `${baseUrl(await headers())}/n/${criarToken(nota.id, await segredoDoLink())}`;
  const quando = (d: string) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  return (
    <EnviarNota
      notaId={nota.id}
      email={nota.tomador?.email ?? null}
      telefone={nota.tomador?.telefone ?? null}
      textoWhatsApp={textoWhatsApp(dadosDaNota(nota), link, DIAS_LINK)}
      envios={(envios ?? []).map((e) => ({ canal: e.canal, destinatario: e.destinatario, situacao: e.situacao, erro: e.erro, quando: quando(e.criado_em) }))}
    />
  );
}
