import Link from "next/link";
import { ItensMenu, type GrupoMenu } from "@/components/menu-lateral";
import { eEscritorio } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { empresaAtual } from "@/lib/empresa-atual";
import { documento } from "@/lib/formato";

export const dynamic = "force-dynamic";

const PAPEL: Record<string, string> = { escritorio_admin: "escritório · admin", escritorio_operador: "escritório", cliente_admin: "cliente · admin", cliente_usuario: "cliente" };

function iniciais(t: string): string {
  return t.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const perfil = await perfilAtual();
  const escritorio = eEscritorio(perfil);
  const producao = process.env.NFSE_AMBIENTE === "producao";
  const empresa = await empresaAtual(perfil);
  const daEmpresa = [
    { href: "/painel", rotulo: "Painel" },
    { href: "/notas", rotulo: "Notas" },
    { href: "/notas/nova", rotulo: "Nova nota" },
    { href: "/tomadores", rotulo: "Tomadores (clientes)" },
    { href: "/servicos", rotulo: "Serviços" },
    { href: "/importar", rotulo: "Importar" },
  ];
  // Escritório: primeiro escolhe a empresa na lista; os itens da empresa aparecem quando ela está aberta.
  const grupos: GrupoMenu[] = escritorio
    ? [
        { itens: [{ href: "/empresas", rotulo: "Empresas" }] },
        ...(empresa ? [{ titulo: "Empresa aberta", itens: [...daEmpresa, { href: `/empresas/${empresa.id}`, rotulo: "Cadastro da empresa" }] }] : []),
        { titulo: "Escritório", itens: [{ href: "/notas?todas=1", rotulo: "Notas de todas as empresas" }, { href: "/avisos", rotulo: "Avisos" }, { href: "/municipios", rotulo: "Municípios" }] },
      ]
    : [{ itens: [...daEmpresa, ...(perfil.papel === "cliente_admin" && perfil.empresaId ? [{ href: `/empresas/${perfil.empresaId}`, rotulo: "Minha empresa" }] : [])] }];
  const nome = perfil.nome ?? perfil.email ?? "";
  return (
    <>
      <div className={`faixa ${producao ? "producao" : "restrita"}`}>
        {producao ? "PRODUÇÃO · notas com valor fiscal" : "PRODUÇÃO RESTRITA · teste, sem valor fiscal"}
      </div>
      <div className="casca">
        <aside className="menu">
          <Link href={escritorio ? "/empresas" : "/painel"} className="marca">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-chriscon.svg" alt="" width={38} height={38} />
            <span><strong>CHRISCON · NFS-e</strong><small>emissor de notas</small></span>
          </Link>
          {escritorio && (empresa ? (
            <div className="aberta">
              <span className="suave">Trabalhando em</span>
              <strong title={empresa.razao_social}>{empresa.razao_social}</strong>
              <span className="suave">{documento(empresa.cnpj)}{empresa.pausada ? " · pausada" : ""}</span>
              <a href="/api/empresa-atual">Trocar de empresa</a>
            </div>
          ) : (
            <div className="aberta vazia"><span>Nenhuma empresa aberta.</span><span className="suave">Abra uma em Empresas para ver painel, notas, tomadores e serviços dela.</span></div>
          ))}
          <ItensMenu grupos={grupos} />
          <div className="quem"><i aria-hidden="true">{iniciais(nome)}</i><span><b>{nome}</b>{PAPEL[perfil.papel] ?? perfil.papel}</span></div>
        </aside>
        <main>{children}</main>
      </div>
    </>
  );
}
