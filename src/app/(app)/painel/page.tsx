import Link from "next/link";
import { redirect } from "next/navigation";
import { eEscritorio } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { supabaseServidor } from "@/lib/supabase/server";

const SITUACOES = ["rascunho", "na_fila", "enviando", "autorizada", "rejeitada", "cancelada", "substituida"] as const;
/** início da janela do painel: 2 meses atrás (fora do componente, para a regra de pureza do React) */
function desde(): string {
  return new Date(Date.now() - 62 * 86_400_000).toISOString();
}

const ROTULO: Record<string, string> = { rascunho: "Rascunho", na_fila: "Na fila", enviando: "Enviando", autorizada: "Autorizada", rejeitada: "Rejeitada", cancelada: "Cancelada", substituida: "Substituída" };

/** Painel do escritório: notas por empresa e situação, empresas pausadas e avisos não lidos. */
export default async function Painel() {
  const perfil = await perfilAtual();
  if (!eEscritorio(perfil)) redirect("/notas");
  const db = await supabaseServidor();
  const [{ data: empresas }, { data: notas }, { count: avisos }] = await Promise.all([
    db.from("empresa").select("id, razao_social, cnpj, regime, pausada, motivo_pausa").eq("ativa", true).order("razao_social"),
    db.from("nota").select("empresa_id, situacao").gte("criado_em", desde()),
    db.from("aviso").select("id", { count: "exact", head: true }).is("lido_em", null),
  ]);
  const cont = new Map<string, Record<string, number>>();
  for (const n of notas ?? []) {
    const m = cont.get(n.empresa_id) ?? {};
    m[n.situacao] = (m[n.situacao] ?? 0) + 1;
    cont.set(n.empresa_id, m);
  }
  return (
    <>
      <h1>Painel</h1>
      {(avisos ?? 0) > 0 && <div className="msg alerta"><Link href="/avisos">{avisos} aviso(s) não lido(s)</Link></div>}
      <p className="suave">Notas criadas nos últimos 2 meses.</p>
      <div className="tabela">
        <table>
          <thead>
            <tr><th>Empresa</th>{SITUACOES.map((s) => <th key={s} className="num">{ROTULO[s]}</th>)}</tr>
          </thead>
          <tbody>
            {(empresas ?? []).map((e) => (
              <tr key={e.id}>
                <td>
                  <Link href={`/notas?empresa=${e.id}`}>{e.razao_social}</Link>
                  <div className="suave">{e.cnpj} · {e.regime}{e.pausada ? ` · PAUSADA: ${e.motivo_pausa ?? ""}` : ""}</div>
                </td>
                {SITUACOES.map((s) => <td key={s} className="num">{cont.get(e.id)?.[s] ?? 0}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
