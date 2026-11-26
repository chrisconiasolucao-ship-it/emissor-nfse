import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eEscritorio } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { supabaseServidor } from "@/lib/supabase/server";

async function marcarLido(form: FormData) {
  "use server";
  const perfil = await perfilAtual();
  if (!eEscritorio(perfil)) return;
  const db = await supabaseServidor();
  await db.from("aviso").update({ lido_em: new Date().toISOString(), lido_por: perfil.usuarioId }).eq("id", String(form.get("id")));
  revalidatePath("/avisos");
}

/** Avisos do escritório (SHOULD): emissões, cancelamentos e substituições de clientes, certificados, fila. */
export default async function Avisos({ searchParams }: { searchParams: Promise<{ todos?: string }> }) {
  const perfil = await perfilAtual();
  if (!eEscritorio(perfil)) redirect("/notas");
  const { todos } = await searchParams;
  const db = await supabaseServidor();
  let q = db.from("aviso").select("id, empresa_id, tipo, nota_id, mensagem, quem_email, quando, lido_em, empresa:empresa_id(razao_social)").order("quando", { ascending: false }).limit(200);
  if (!todos) q = q.is("lido_em", null);
  const { data } = await q;
  return (
    <>
      <h1>Avisos</h1>
      <p><Link href={todos ? "/avisos" : "/avisos?todos=1"}>{todos ? "Só não lidos" : "Ver todos"}</Link></p>
      {(data ?? []).length === 0 && <p className="suave">Nenhum aviso.</p>}
      {(data ?? []).map((a) => (
        <div key={a.id} className="cartao">
          <div className="acoes">
            <span className="selo">{a.tipo.replace(/_/g, " ")}</span>
            <strong>{(a.empresa as unknown as { razao_social?: string } | null)?.razao_social ?? "Sistema"}</strong>
            <span className="suave">{new Date(a.quando).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}{a.quem_email ? ` · ${a.quem_email}` : ""}</span>
          </div>
          <p>{a.mensagem}</p>
          <div className="acoes">
            {a.nota_id && <Link href={`/notas/${a.nota_id}`}>Abrir nota</Link>}
            {!a.lido_em && (
              <form action={marcarLido}>
                <input type="hidden" name="id" value={a.id} />
                <button className="secundario" type="submit">Marcar como lido</button>
              </form>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
