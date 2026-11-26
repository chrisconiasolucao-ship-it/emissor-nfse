import Link from "next/link";
import { ItensMenu, type ItemMenu } from "@/components/menu-lateral";
import { eEscritorio } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";

const PAPEL: Record<string, string> = { escritorio_admin: "escritório · admin", escritorio_operador: "escritório", cliente_admin: "cliente · admin", cliente_usuario: "cliente" };

function iniciais(t: string): string {
  return t.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const perfil = await perfilAtual();
  const escritorio = eEscritorio(perfil);
  const producao = process.env.NFSE_AMBIENTE === "producao";
  const itens: ItemMenu[] = [
    ...(escritorio ? [{ href: "/painel", rotulo: "Painel" }] : []),
    { href: "/notas", rotulo: "Notas" },
    { href: "/notas/nova", rotulo: "Nova nota" },
    { href: "/cadastros", rotulo: "Cadastros" },
    { href: "/importar", rotulo: "Importar" },
    ...(escritorio ? [{ href: "/avisos", rotulo: "Avisos" }] : []),
    ...(escritorio || perfil.papel === "cliente_admin" ? [{ href: "/empresas", rotulo: "Empresas" }] : []),
    ...(escritorio ? [{ href: "/municipios", rotulo: "Municípios" }] : []),
  ];
  const nome = perfil.nome ?? perfil.email ?? "";
  return (
    <>
      <div className={`faixa ${producao ? "producao" : "restrita"}`}>
        {producao ? "PRODUÇÃO · notas com valor fiscal" : "PRODUÇÃO RESTRITA · teste, sem valor fiscal"}
      </div>
      <div className="casca">
        <aside className="menu">
          <Link href={escritorio ? "/painel" : "/notas"} className="marca">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-chriscon.svg" alt="" width={38} height={38} />
            <span><strong>CHRISCON · NFS-e</strong><small>emissor de notas</small></span>
          </Link>
          <ItensMenu itens={itens} />
          <div className="quem"><i aria-hidden="true">{iniciais(nome)}</i><span><b>{nome}</b>{PAPEL[perfil.papel] ?? perfil.papel}</span></div>
        </aside>
        <main>{children}</main>
      </div>
    </>
  );
}
