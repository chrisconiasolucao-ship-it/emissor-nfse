import { EscolhaEmpresa } from "@/components/escolha-empresa";
import { perfilAtual } from "@/lib/auth/sessao";
import { empresaAtual } from "@/lib/empresa-atual";
import { documento } from "@/lib/formato";
import { competenciaAtual } from "@/lib/importacao/repetir-mes";
import { reais, somar } from "@/lib/money";
import { periodo } from "@/lib/notas/importadas";
import { LIMITE_COM_PDF, LIMITE_XML, montarLote, tipoLote } from "@/lib/notas/lote";
import { lerDadosDoLote } from "@/lib/notas/lote-dados";
import { supabaseServidor } from "@/lib/supabase/server";

const TIPOS: [string, string][] = [["ambas", "Prestadas e tomadas"], ["prestadas", "Só prestadas"], ["tomadas", "Só tomadas"]];
const mesAno = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

/** Mês anterior ao atual ("AAAA-MM"): o escritório costuma fechar o mês que passou. */
function mesAnterior(atual: string): string {
  const [a = 0, m = 1] = atual.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * Baixar em lote (pedido do José, 27/11/2026): escolhe o período e o tipo, vê quantas notas entram e baixa um
 * ZIP com os XMLs (e os PDFs, se marcar) para importar no sistema contábil do escritório.
 */
export default async function Baixar({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; tipo?: string; pdf?: string; aviso?: string }> }) {
  const perfil = await perfilAtual();
  const busca = await searchParams;
  const db = await supabaseServidor();
  const empresa = await empresaAtual(perfil);
  if (!empresa) {
    const { data: empresas } = await db.from("empresa").select("id, razao_social, cnpj, regime").eq("ativa", true).order("razao_social");
    return (
      <>
        <div className="cab"><div><h1>Baixar notas em lote</h1><p>Escolha a empresa.</p></div></div>
        <div className="cartao"><EscolhaEmpresa empresas={(empresas ?? []).map((x) => ({ id: x.id, titulo: x.razao_social, detalhe: `CNPJ ${documento(x.cnpj)} · ${x.regime}` }))} para="/baixar" /></div>
      </>
    );
  }

  const { de, ate } = periodo(busca, mesAnterior(competenciaAtual().slice(0, 7)));
  const tipo = tipoLote(busca.tipo);
  const pdf = busca.pdf === "1";
  const dados = await lerDadosDoLote(db, empresa.id, de, ate);
  const { resumo } = montarLote({ tipo, pdf: false, ...dados });
  const conta = (t: "Prestada" | "Tomada") => {
    const l = resumo.filter((r) => r.tipo === t);
    return { n: l.length, total: l.length ? somar(...l.map((r) => (r.valor ? r.valor.replace(",", ".") : "0"))) : "0.00" };
  };
  const prest = conta("Prestada");
  const tom = conta("Tomada");
  const limite = pdf ? LIMITE_COM_PDF : LIMITE_XML;
  const textoPeriodo = de && ate ? (de === ate ? `competência ${mesAno(de)}` : `competências ${mesAno(de)} a ${mesAno(ate)}`) : de ? `desde ${mesAno(de)}` : ate ? `até ${mesAno(ate)}` : "todos os meses";

  const qs = new URLSearchParams({ de: de ?? "", ate: ate ?? "", tipo, ...(pdf ? { pdf: "1" } : {}) });

  return (
    <>
      <div className="cab">
        <div><h1>Baixar notas em lote</h1><p>{empresa.razao_social} · CNPJ {documento(empresa.cnpj)}</p></div>
      </div>

      {busca.aviso === "vazio" && <p className="msg alerta" style={{ marginBottom: 12 }}>Não há notas nesse período para baixar.</p>}
      {busca.aviso === "grande" && <p className="msg alerta" style={{ marginBottom: 12 }}>São muitas notas para um arquivo só. Escolha um período menor{pdf ? " ou desmarque os PDFs" : ""}.</p>}

      <form className="grade cartao" method="get" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1.2fr) auto", alignItems: "end" }}>
        <label>Competência de<input type="month" name="de" defaultValue={de ?? ""} /></label>
        <label>até<input type="month" name="ate" defaultValue={ate ?? ""} /></label>
        <label>Notas
          <select name="tipo" defaultValue={tipo}>
            {TIPOS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Incluir os PDFs (DANFSe)<input type="checkbox" name="pdf" value="1" defaultChecked={pdf} /></label>
        <div className="acoes"><button type="submit" className="secundario">Ver notas</button></div>
      </form>
      <p className="suave" style={{ margin: "0 0 16px" }}>Deixe as competências em branco para pegar todos os meses. As tomadas aparecem depois da busca no ADN (tela Importar).</p>

      <section className="cartao" aria-labelledby="t-lote">
        <h3 id="t-lote" style={{ marginTop: 0 }}>{textoPeriodo}</h3>
        <div className="filtros" style={{ marginBottom: 16 }}>
          {tipo !== "tomadas" && <span className="cartao" style={{ padding: "8px 14px" }}>Prestadas: <b>{prest.n}</b> <span className="suave">· {reais(prest.total)}</span></span>}
          {tipo !== "prestadas" && <span className="cartao" style={{ padding: "8px 14px" }}>Tomadas: <b>{tom.n}</b> <span className="suave">· {reais(tom.total)}</span></span>}
        </div>
        {resumo.length === 0
          ? <p className="suave" style={{ margin: 0 }}>Nenhuma nota nesse período.</p>
          : resumo.length > limite
            ? <p className="msg alerta">São {resumo.length} notas, acima do limite de {limite} por arquivo. Escolha um período menor{pdf ? " ou desmarque os PDFs" : ""}.</p>
            : (
              <>
                <div className="acoes"><a className="botao" href={`/api/notas/lote?${qs.toString()}`} download>Baixar ZIP ({resumo.length} {resumo.length === 1 ? "nota" : "notas"})</a></div>
                <p className="suave" style={{ marginBottom: 0 }}>
                  O ZIP traz as pastas <b>prestadas</b> e <b>tomadas</b> com os XMLs, prontas para importar no sistema contábil,
                  o XML do cancelamento em <b>eventos</b>{pdf ? <>, o DANFSe em <b>PDF</b></> : null} e a planilha <b>resumo.csv</b> para conferir no Excel.
                  {pdf && resumo.length > 200 ? " Com PDFs, pode levar alguns minutos." : ""}
                </p>
              </>
            )}
      </section>
    </>
  );
}
