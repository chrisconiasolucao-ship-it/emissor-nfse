import Link from "next/link";
import { redirect } from "next/navigation";
import { Formulario } from "@/components/formulario";
import { podeGerirEmpresas } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { documento } from "@/lib/formato";
import { supabaseServidor } from "@/lib/supabase/server";
import { alterarAtivaEmpresa } from "../actions";

/** Atalho do escritório para ativar e desativar empresas, todas numa lista; o resto fica no cadastro de cada uma. */
export default async function GerenciarEmpresas({ searchParams }: { searchParams: Promise<{ q?: string; ver?: string }> }) {
  const perfil = await perfilAtual();
  if (!podeGerirEmpresas(perfil)) redirect("/painel");
  const p = await searchParams;
  const db = await supabaseServidor();
  const { data } = await db.from("empresa").select("id, razao_social, cnpj, regime, ativa, pausada").order("razao_social");
  const termo = (p.q ?? "").trim().toLowerCase();
  const dig = termo.replace(/\D/g, "");
  const todas = data ?? [];
  const ativas = todas.filter((e) => e.ativa).length;
  const lista = todas
    .filter((e) => (p.ver === "ativas" ? e.ativa : p.ver === "desativadas" ? !e.ativa : true))
    .filter((e) => !termo || e.razao_social.toLowerCase().includes(termo) || (dig.length > 0 && e.cnpj.includes(dig)));
  const filtro = (ver: string, rotulo: string) => {
    const u = new URLSearchParams();
    if (p.q) u.set("q", p.q);
    if (ver) u.set("ver", ver);
    const q = u.toString();
    return <Link className="filtro" href={q ? `/empresas/gerenciar?${q}` : "/empresas/gerenciar"} aria-current={(p.ver ?? "") === ver ? "true" : undefined}>{rotulo}</Link>;
  };
  return (
    <>
      <div className="cab">
        <div><h1>Gerenciar empresas</h1><p>{ativas} ativas · {todas.length - ativas} desativadas. Empresa desativada sai das listas, do menu e da busca no ADN; notas e cadastros ficam guardados.</p></div>
        <div className="acoes"><Link className="botao" href="/empresas/nova">+ Cadastrar empresa</Link></div>
      </div>
      <section className="cartao lista-cadastro">
        <form className="busca-linha" action="/empresas/gerenciar">
          {p.ver && <input type="hidden" name="ver" value={p.ver} />}
          <input name="q" defaultValue={p.q ?? ""} aria-label="Procurar" placeholder="Procurar por nome ou CNPJ" />
          <button type="submit" className="secundario">Procurar</button>
          <nav className="filtros dir" aria-label="Situação">{filtro("", "Todas")}{filtro("ativas", "Ativas")}{filtro("desativadas", "Desativadas")}</nav>
        </form>
        <div className="tabela sem-borda">
          <table>
            <thead><tr><th>Empresa</th><th>Regime</th><th>Situação</th><th><span className="so-leitor">Ações</span></th></tr></thead>
            <tbody>
              {lista.length === 0 && <tr><td colSpan={4} className="suave">Nenhuma empresa com estes filtros.</td></tr>}
              {lista.map((e) => (
                <tr key={e.id}>
                  <td><Link className="nome-link" href={`/empresas/${e.id}`}>{e.razao_social}</Link><span className="suave">{documento(e.cnpj)}</span></td>
                  <td>{e.regime}</td>
                  <td><span className={`selo ${!e.ativa ? "cancelada" : e.pausada ? "na_fila" : "autorizada"}`}>{!e.ativa ? "Desativada" : e.pausada ? "Ativa · emissão pausada" : "Ativa"}</span></td>
                  <td className="num">
                    <div className="acoes" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                      <Link className="botao mini secundario" href={`/empresas/${e.id}`}>Cadastro</Link>
                      <Formulario acao={alterarAtivaEmpresa} className="em-linha" botao={<button type="submit" className={`mini ${e.ativa ? "secundario" : ""}`}>{e.ativa ? "Desativar" : "Ativar"}</button>}>
                        <input type="hidden" name="empresa_id" value={e.id} />
                        <input type="hidden" name="ativa" value={e.ativa ? "false" : "true"} />
                      </Formulario>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
