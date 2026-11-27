import Link from "next/link";
import { EscolhaEmpresa } from "@/components/escolha-empresa";
import { Formulario } from "@/components/formulario";
import { perfilAtual } from "@/lib/auth/sessao";
import { diasParaVencer } from "@/lib/crypto/pfx";
import { empresaAtual } from "@/lib/empresa-atual";
import { documento } from "@/lib/formato";
import { competenciaAtual } from "@/lib/importacao/repetir-mes";
import { reais } from "@/lib/money";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServidor } from "@/lib/supabase/server";
import { buscarNoAdn, importarPlanilha, importarXmlModelo, repetirMesAnterior } from "../notas/actions";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
type Doc = { id: string; criado_em: string; nome_original: string | null; papel?: string | null; outra_parte?: string | null; outra_parte_documento?: string | null; numero_nfse?: string | null; competencia?: string | null; valor?: string | number | null };

const quando = (iso: string) => {
  const d = new Date(iso);
  const hoje = new Date();
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  const dia = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return dia === hoje.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) ? `hoje às ${hora}` : `${dia} às ${hora}`;
};

/**
 * Importar, com a busca no ADN da Receita em destaque (layout A escolhido pelo José em 27/11/2026): a faixa do
 * topo busca pelo certificado A1 as NFS-e prestadas e tomadas da empresa aberta; planilha, XML avulso e repetir
 * o mês ficam em cartões menores embaixo.
 */
export default async function Importar() {
  const perfil = await perfilAtual();
  const db = await supabaseServidor();
  const empresa = await empresaAtual(perfil);
  if (!empresa) {
    const { data: empresas } = await db.from("empresa").select("id, razao_social, cnpj, regime").eq("ativa", true).order("razao_social");
    return (
      <>
        <div className="cab"><div><h1>Importar</h1><p>Escolha a empresa. A busca no ADN usa o certificado dela.</p></div></div>
        <div className="cartao"><EscolhaEmpresa empresas={(empresas ?? []).map((x) => ({ id: x.id, titulo: x.razao_social, detalhe: `CNPJ ${documento(x.cnpj)} · ${x.regime}` }))} para="/importar" /></div>
      </>
    );
  }
  const id = empresa.id;
  const atual = competenciaAtual();
  const inicioMes = `${atual}T00:00:00-03:00`;
  const [{ data: cert }, { data: cursor }, recentes] = await Promise.all([
    db.from("certificado").select("valido_ate").eq("empresa_id", id).eq("ativo", true).maybeSingle(),
    // adn_cursor não é legível pela tela (0006); a empresa já foi conferida pelo RLS em empresaAtual
    supabaseAdmin().from("adn_cursor").select("ultimo_nsu, atualizado_em").eq("empresa_id", id).maybeSingle(),
    db.from("documento").select("id, criado_em, nome_original, papel, outra_parte, outra_parte_documento, numero_nfse, competencia, valor").eq("empresa_id", id).eq("tipo", "xml_origem").order("criado_em", { ascending: false }).limit(8),
  ]);
  // banco ainda sem a migration 0015: mostra os XMLs sem o resumo
  const docs: Doc[] = recentes.error
    ? ((await db.from("documento").select("id, criado_em, nome_original").eq("empresa_id", id).eq("tipo", "xml_origem").order("criado_em", { ascending: false }).limit(8)).data ?? [])
    : ((recentes.data ?? []) as Doc[]);
  const contar = (papel: string) => db.from("documento").select("id", { count: "exact", head: true }).eq("empresa_id", id).eq("tipo", "xml_origem").eq("papel", papel).gte("criado_em", inicioMes);
  const [prest, tom] = recentes.error ? [null, null] : await Promise.all([contar("prestada"), contar("tomada")]);
  const dias = cert ? diasParaVencer(new Date(cert.valido_ate)) : null;
  const mes = MESES[Number(atual.slice(5, 7)) - 1];

  return (
    <>
      <div className="cab">
        <div><h1>Importar</h1><p>{empresa.razao_social} · CNPJ {documento(empresa.cnpj)}</p></div>
      </div>

      <section className="adn" aria-labelledby="t-adn">
        <div className="adn-texto">
          <span className="adn-rot">Ambiente Nacional · certificado A1</span>
          <h2 id="t-adn">Buscar notas no ADN da Receita</h2>
          <p>Traz as NFS-e em que a empresa aparece, prestadas e tomadas, direto do Ambiente de Dados Nacional, usando o certificado guardado. As prestadas viram modelo e preenchem tomadores e serviços.</p>
          {cert
            ? (
              <Formulario acao={buscarNoAdn} className="adn-acao" botao={<button type="submit">Buscar agora</button>}>
                <input type="hidden" name="empresa_id" value={id} />
                <small>Também roda sozinha todo dia às 6h.</small>
              </Formulario>
            )
            : <p className="adn-aviso">Sem certificado A1, a busca não roda. <Link href={`/empresas/${id}`}>Enviar certificado</Link></p>}
        </div>
        <div className="adn-numeros">
          <div><b>{prest?.count ?? "—"}</b><span>prestadas guardadas em {mes}</span></div>
          <div><b>{tom?.count ?? "—"}</b><span>tomadas guardadas em {mes}</span></div>
          <div className="larga">
            <span>{cursor?.atualizado_em ? `Última busca ${quando(cursor.atualizado_em)} · NSU ${Number(cursor.ultimo_nsu).toLocaleString("pt-BR")}` : "Nenhuma busca feita ainda"}</span>
            {cert && <span className={`selo ${dias !== null && dias <= 30 ? "na_fila" : "autorizada"}`}>certificado válido até {new Date(cert.valido_ate).toLocaleDateString("pt-BR")}</span>}
          </div>
        </div>
      </section>

      <section className="cartao lista-cadastro" aria-labelledby="t-recentes">
        <div className="cartao-cab busca-linha" style={{ margin: 0 }}><h3 id="t-recentes" style={{ margin: 0 }}>Últimas notas guardadas</h3><span className="suave dir">do ADN e de XML enviado</span></div>
        {docs.length === 0 ? <p className="suave" style={{ padding: 16, margin: 0 }}>Nenhuma nota guardada ainda. Use “Buscar agora”.</p> : (
          <div className="tabela sem-borda">
            <table>
              <thead><tr><th>Tipo</th><th>Outra parte</th><th>Competência</th><th className="num">Valor</th><th><span className="so-leitor">Ações</span></th></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>{d.papel ? <span className={`etiqueta ${d.papel}`}>{d.papel}</span> : <span className="suave">—</span>}</td>
                    <td>
                      <strong>{d.outra_parte ?? d.nome_original ?? "NFS-e"}</strong>
                      <span className="suave">{d.outra_parte_documento ? documento(d.outra_parte_documento) : ""}{d.numero_nfse ? `${d.outra_parte_documento ? " · " : ""}nº ${d.numero_nfse}` : ""}{!d.outra_parte_documento && !d.numero_nfse ? `guardada ${quando(d.criado_em)}` : ""}</span>
                    </td>
                    <td className="nowrap">{d.competencia ? `${d.competencia.slice(5, 7)}/${d.competencia.slice(0, 4)}` : "—"}</td>
                    <td className="num">{d.valor != null ? reais(d.valor) : "—"}</td>
                    <td className="num">
                      {d.papel === "tomada"
                        ? <a className="botao mini secundario" href={`/api/documentos/${d.id}`}>Baixar XML</a>
                        : <Link className="botao mini secundario" href={`/notas/nova?documento=${d.id}`}>Usar como modelo</Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="outras-importacoes">
        <section className="cartao" aria-labelledby="t-planilha">
          <h3 id="t-planilha">Planilha</h3>
          <p className="suave">Até 30 notas por arquivo, no <a href="/api/modelo-planilha">modelo padrão</a>. Cada linha vira uma nota na fila.</p>
          <Formulario acao={importarPlanilha} botao={<button type="submit" className="secundario">Enviar planilha</button>}>
            <input type="hidden" name="empresa_id" value={id} />
            <label>Arquivo (.xlsx ou .csv)<input name="arquivo" type="file" accept=".xlsx,.csv" required /></label>
          </Formulario>
        </section>
        <section className="cartao" aria-labelledby="t-xml">
          <h3 id="t-xml">XML avulso</h3>
          <p className="suave">Uma NFS-e em XML vira modelo para a próxima nota.</p>
          <Formulario acao={importarXmlModelo} botao={<button type="submit" className="secundario">Enviar XML</button>}>
            <input type="hidden" name="empresa_id" value={id} />
            <label>XML de NFS-e<input name="arquivo" type="file" accept=".xml" required /></label>
          </Formulario>
        </section>
        <section className="cartao" aria-labelledby="t-repetir">
          <h3 id="t-repetir">Repetir o mês anterior</h3>
          <p className="suave">Cria rascunhos na competência escolhida a partir das notas autorizadas do mês anterior a ela. Confira e emita na lista de notas.</p>
          <Formulario acao={repetirMesAnterior} botao={<button type="submit" className="secundario">Criar rascunhos</button>}>
            <input type="hidden" name="empresa_id" value={id} />
            <label>Competência nova<input name="competencia" type="month" defaultValue={atual.slice(0, 7)} required /></label>
          </Formulario>
        </section>
      </div>
    </>
  );
}
