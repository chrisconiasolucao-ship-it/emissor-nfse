import Link from "next/link";
import { CampoMunicipio } from "@/components/campo-municipio";
import { CamposServico } from "@/components/campos-servico";
import { Formulario } from "@/components/formulario";
import { eEscritorio } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { reais } from "@/lib/money";
import { supabaseServidor } from "@/lib/supabase/server";
import { arquivarServico, excluirTomador, salvarServico, salvarTomador } from "./actions";

type Busca = { empresa?: string; aba?: string; q?: string; editar?: string; arquivados?: string };
type Linha = Record<string, string | number | boolean | null>;
const s = (v: unknown) => (v == null ? "" : String(v));
const ORIGEM: Record<string, string> = { manual: "cadastro", nota: "nota emitida", planilha: "planilha", xml: "XML importado", adn: "ADN" };

/** Cadastros da empresa: tomadores (clientes) e serviços, usados para preencher a nova nota. */
export default async function Cadastros({ searchParams }: { searchParams: Promise<Busca> }) {
  const perfil = await perfilAtual();
  const p = await searchParams;
  const db = await supabaseServidor();
  const { data: empresas } = await db.from("empresa").select("id, razao_social").eq("ativa", true).order("razao_social");
  const lista = empresas ?? [];
  const empresaId = p.empresa ?? (eEscritorio(perfil) ? (lista.length === 1 ? lista[0]!.id : undefined) : (perfil.empresaId ?? undefined));
  const aba = p.aba === "servicos" ? "servicos" : "tomadores";
  const termo = (p.q ?? "").trim().replace(/[%_,()*]/g, "");
  const url = (extra: Partial<Busca>) => {
    const u = new URLSearchParams();
    const tudo = { empresa: empresaId, aba, q: p.q, arquivados: p.arquivados, ...extra };
    for (const [k, v] of Object.entries(tudo)) if (v) u.set(k, String(v));
    return `/cadastros?${u.toString()}`;
  };

  let linhas: Linha[] = [];
  let edicao: Linha | null = null;
  if (empresaId) {
    if (aba === "tomadores") {
      let q = db.from("tomador").select("*").eq("empresa_id", empresaId).order("nome").limit(200);
      if (termo) q = q.or(`nome.ilike.%${termo}%,documento.like.${termo.replace(/\D/g, "") || "x"}%`);
      linhas = ((await q).data ?? []) as Linha[];
      if (p.editar) edicao = ((await db.from("tomador").select("*").eq("empresa_id", empresaId).eq("id", p.editar).maybeSingle()).data ?? null) as Linha | null;
    } else {
      let q = db.from("servico").select("*").eq("empresa_id", empresaId).eq("ativo", p.arquivados !== "1").order("nome", { nullsFirst: false }).order("descricao").limit(200);
      if (termo) q = q.or(`nome.ilike.%${termo}%,descricao.ilike.%${termo}%,codigo_tributacao_nacional.like.${termo}%`);
      linhas = ((await q).data ?? []) as Linha[];
      if (p.editar) edicao = ((await db.from("servico").select("*").eq("empresa_id", empresaId).eq("id", p.editar).maybeSingle()).data ?? null) as Linha | null;
    }
  }
  const e = edicao ?? {};

  return (
    <>
      <h1>Cadastros</h1>
      <form className="acoes cartao" action="/cadastros">
        <label>Empresa
          <select name="empresa" defaultValue={empresaId ?? ""} required>
            <option value="" disabled>Escolha</option>
            {lista.map((x) => <option key={x.id} value={x.id}>{x.razao_social}</option>)}
          </select>
        </label>
        <input type="hidden" name="aba" value={aba} />
        <label>Procurar<input name="q" defaultValue={p.q ?? ""} placeholder={aba === "tomadores" ? "nome ou CPF/CNPJ" : "nome, descrição ou código"} /></label>
        <button type="submit">Mostrar</button>
      </form>

      {!empresaId ? (
        <p className="suave">Escolha a empresa para ver os cadastros dela.</p>
      ) : (
        <>
          <nav className="acoes" style={{ marginBottom: 12 }}>
            <Link href={url({ aba: "tomadores", editar: undefined, q: undefined })} className={aba === "tomadores" ? "" : "suave"}>Tomadores (clientes)</Link>
            <Link href={url({ aba: "servicos", editar: undefined, q: undefined })} className={aba === "servicos" ? "" : "suave"}>Serviços</Link>
          </nav>
          <p className="suave">
            Tomadores e serviços também entram sozinhos: das notas emitidas, da planilha e dos XMLs importados (envio de XML ou busca no ADN) em que a empresa é a prestadora.
          </p>

          {aba === "tomadores" ? (
            <>
              <div className="tabela">
                <table>
                  <thead><tr><th>Nome</th><th>CPF/CNPJ</th><th>E-mail</th><th>Origem</th><th></th></tr></thead>
                  <tbody>
                    {linhas.length === 0 && <tr><td colSpan={5} className="suave">Nenhum tomador{termo ? " encontrado" : " ainda"}.</td></tr>}
                    {linhas.map((t) => (
                      <tr key={s(t.id)}>
                        <td>{s(t.nome)}</td><td>{s(t.tipo_documento)} {s(t.documento)}</td><td>{s(t.email)}</td>
                        <td className="suave">{ORIGEM[s(t.origem)] ?? s(t.origem)}</td>
                        <td className="acoes">
                          <Link href={url({ editar: s(t.id) })}>Editar</Link>
                          <Link href={`/notas/nova?empresa=${empresaId}&tomador=${s(t.id)}`}>Nova nota</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h2>{edicao ? `Editar ${s(e.nome)}` : "Novo tomador"}</h2>
              <div className="cartao">
                <Formulario key={s(e.id) || "novo"} acao={salvarTomador} className="grade" botao={<button type="submit">{edicao ? "Salvar" : "Cadastrar"}</button>}>
                  <input type="hidden" name="empresa_id" value={empresaId} />
                  {edicao && <input type="hidden" name="id" value={s(e.id)} />}
                  <label>Tipo
                    <select name="tipo_documento" defaultValue={s(e.tipo_documento) || "CPF"}><option value="CPF">CPF</option><option value="CNPJ">CNPJ</option></select>
                  </label>
                  <label>CPF/CNPJ<input name="documento" defaultValue={s(e.documento)} required /></label>
                  <label className="largo">Nome<input name="nome" defaultValue={s(e.nome)} required /></label>
                  <label>E-mail<input name="email" type="email" defaultValue={s(e.email)} /></label>
                  <label>Telefone<input name="telefone" defaultValue={s(e.telefone)} /></label>
                  <label>CEP<input name="cep" defaultValue={s(e.cep)} /></label>
                  <label>Município<CampoMunicipio name="cod_municipio" codigo={s(e.cod_municipio)} /></label>
                  <label>Logradouro<input name="logradouro" defaultValue={s(e.logradouro)} /></label>
                  <label>Número<input name="numero" defaultValue={s(e.numero)} /></label>
                  <label>Complemento<input name="complemento" defaultValue={s(e.complemento)} /></label>
                  <label>Bairro<input name="bairro" defaultValue={s(e.bairro)} /></label>
                </Formulario>
                {edicao && (
                  <Formulario acao={excluirTomador} botao={<button type="submit" className="secundario">Excluir tomador</button>}>
                    <input type="hidden" name="empresa_id" value={empresaId} />
                    <input type="hidden" name="id" value={s(e.id)} />
                  </Formulario>
                )}
                {edicao && <p><Link href={url({ editar: undefined })}>Cancelar edição</Link></p>}
              </div>
            </>
          ) : (
            <>
              <p className="acoes">
                {p.arquivados === "1"
                  ? <Link href={url({ arquivados: undefined, editar: undefined })}>Ver serviços ativos</Link>
                  : <Link href={url({ arquivados: "1", editar: undefined })} className="suave">Ver arquivados</Link>}
              </p>
              <div className="tabela">
                <table>
                  <thead><tr><th>Nome</th><th>Código</th><th>Descrição</th><th>Valor</th><th>Origem</th><th></th></tr></thead>
                  <tbody>
                    {linhas.length === 0 && <tr><td colSpan={6} className="suave">Nenhum serviço{termo ? " encontrado" : " ainda"}.</td></tr>}
                    {linhas.map((x) => (
                      <tr key={s(x.id)}>
                        <td>{s(x.nome) || <span className="suave">sem nome</span>}</td>
                        <td>{s(x.codigo_tributacao_nacional)}</td>
                        <td>{s(x.descricao).slice(0, 90)}{s(x.descricao).length > 90 ? "…" : ""}</td>
                        <td>{x.valor_padrao == null ? "" : reais(x.valor_padrao as number)}</td>
                        <td className="suave">{ORIGEM[s(x.origem)] ?? s(x.origem)}</td>
                        <td className="acoes">
                          <Link href={url({ editar: s(x.id) })}>Editar</Link>
                          {x.ativo && <Link href={`/notas/nova?empresa=${empresaId}&servico=${s(x.id)}`}>Nova nota</Link>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h2>{edicao ? "Editar serviço" : "Novo serviço"}</h2>
              <div className="cartao">
                <Formulario key={s(e.id) || "novo"} acao={salvarServico} className="grade" botao={<button type="submit">{edicao ? "Salvar" : "Cadastrar"}</button>}>
                  <input type="hidden" name="empresa_id" value={empresaId} />
                  {edicao && <input type="hidden" name="id" value={s(e.id)} />}
                  <label className="largo">Nome curto (para achar na lista)<input name="nome" defaultValue={s(e.nome)} placeholder="ex.: Honorários mensais" maxLength={120} /></label>
                  <CamposServico codigo={s(e.codigo_tributacao_nacional) || undefined} nbs={s(e.codigo_nbs) || undefined} />
                  <label className="largo">Descrição que vai na nota<textarea name="descricao" defaultValue={s(e.descricao)} required maxLength={2000} /></label>
                  <label>Município da prestação<CampoMunicipio name="cod_municipio_prestacao" codigo={s(e.cod_municipio_prestacao)} /><span className="suave">Em branco: o da empresa.</span></label>
                  <label>Valor sugerido (R$)<input name="valor_padrao" defaultValue={s(e.valor_padrao).replace(".", ",")} inputMode="decimal" /></label>
                  <label>ISS retido pelo tomador<input name="iss_retido" type="checkbox" defaultChecked={Boolean(e.iss_retido)} /></label>
                  <label>Alíquota ISS (%) se retido<input name="aliquota_iss" defaultValue={s(e.aliquota_iss).replace(".", ",")} inputMode="decimal" /></label>
                </Formulario>
                {edicao && (
                  <Formulario acao={arquivarServico} botao={<button type="submit" className="secundario">{e.ativo ? "Arquivar serviço" : "Reativar serviço"}</button>}>
                    <input type="hidden" name="empresa_id" value={empresaId} />
                    <input type="hidden" name="id" value={s(e.id)} />
                    <input type="hidden" name="ativo" value={e.ativo ? "false" : "true"} />
                  </Formulario>
                )}
                {edicao && <p><Link href={url({ editar: undefined })}>Cancelar edição</Link></p>}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
