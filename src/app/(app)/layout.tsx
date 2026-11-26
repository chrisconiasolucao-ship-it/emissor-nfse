import Link from "next/link";
import { eEscritorio } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const perfil = await perfilAtual();
  const escritorio = eEscritorio(perfil);
  const producao = process.env.NFSE_AMBIENTE === "producao";
  return (
    <>
      <div className={`faixa ${producao ? "producao" : "restrita"}`}>
        {producao ? "PRODUÇÃO — notas com valor fiscal" : "PRODUÇÃO RESTRITA — teste, sem valor fiscal"}
      </div>
      <header className="topo">
        <strong>CHRISCON · NFS-e</strong>
        <nav>
          {escritorio && <Link href="/painel">Painel</Link>}
          <Link href="/notas">Notas</Link>
          <Link href="/notas/nova">Nova nota</Link>
          <Link href="/importar">Importar</Link>
          {escritorio && <Link href="/avisos">Avisos</Link>}
          {(escritorio || perfil.papel === "cliente_admin") && <Link href="/empresas">Empresas</Link>}
          {escritorio && <Link href="/municipios">Municípios</Link>}
        </nav>
        <span className="quem">{perfil.nome ?? perfil.email} · {perfil.papel.replace("_", " ")}</span>
      </header>
      <main>{children}</main>
    </>
  );
}
