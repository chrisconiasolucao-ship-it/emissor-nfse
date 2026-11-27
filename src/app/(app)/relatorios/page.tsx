import Link from "next/link";
import { eEscritorio } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { empresaAtual } from "@/lib/empresa-atual";
import { RELATORIOS } from "@/lib/relatorios/tipos";

/** Lista dos relatórios: cada um abre com filtros e sai na tela, em PDF e em Excel. */
export default async function Relatorios() {
  const perfil = await perfilAtual();
  const escritorio = eEscritorio(perfil);
  const empresa = await empresaAtual(perfil);
  const lista = RELATORIOS.filter((r) => !r.soEscritorio || escritorio);
  return (
    <>
      <div className="cab">
        <div>
          <h1>Relatórios</h1>
          <p>{empresa ? empresa.razao_social : escritorio ? "Todas as empresas (abra uma empresa ou escolha no filtro do relatório)" : ""} · todos saem na tela, em PDF e em Excel</p>
        </div>
      </div>
      <div className="relatorios">
        {lista.map((r, k) => (
          <Link key={r.chave} href={`/relatorios/${r.chave}`} className="cartao relatorio-cartao">
            <span className="sigla" aria-hidden="true">{k + 1}</span>
            <span><strong>{r.titulo}</strong>{r.soEscritorio && <small className="selo">escritório</small>}<span className="suave">{r.descricao}</span></span>
          </Link>
        ))}
      </div>
    </>
  );
}
