import Link from "next/link";
import { EXEMPLO_RETENCAO, ROTULO_RETENCAO, TRIBUTOS_RETIDOS } from "@/lib/nfse/retencoes";
import { CampoMunicipio } from "@/components/campo-municipio";
import { CamposServico } from "@/components/campos-servico";
import { EscolhaEmpresa } from "@/components/escolha-empresa";
import { Formulario } from "@/components/formulario";
import { Janela } from "@/components/janela";
import { perfilAtual } from "@/lib/auth/sessao";
import { empresaAtual } from "@/lib/empresa-atual";
import { codigoServico, documento } from "@/lib/formato";
import { reais } from "@/lib/money";
import { supabaseServidor } from "@/lib/supabase/server";
import { arquivarServico, excluirTomador, salvarServico, salvarTomador } from "./actions";

export type Busca = { q?: string; editar?: string; novo?: string; arquivados?: string };
type Linha = Record<string, string | number | boolean | null>;
const s = (v: unknown) => (v == null ? "" : String(v));
const ORIGEM: Record<string, string> = { manual: "cadastro", nota: "nota emitida", planilha: "planilha", xml: "XML importado", adn: "ADN" };

/**
 * Tomadores (clientes) ou serviços da empresa aberta, usados para preencher a nova nota. Cada um tem a sua
 * tela no menu; sem empresa aberta, a tela pede para escolher uma.
 */
export async function TelaCadastros({ aba, p }: { aba: "tomadores" | "servicos"; p: Busca }) {
  const perfil = await perfilAtual();
  const db = await supabaseServidor();
  const empresa = await empresaAtual(perfil);
  const empresaId = empresa?.id;
  const base = aba === "tomadores" ? "/tomadores" : "/servicos";
  const termo = (p.q ?? "").trim().replace(/[%_,()*]/g, "");
  const url = (extra: Partial<Busca>) => {
    const u = new URLSearchParams();
    const tudo = { q: p.q, arquivados: p.arquivados, ...extra };
    for (const [k, v] of Object.entries(tudo)) if (v) u.set(k, String(v));
    const q = u.toString();
    return q ? `${base}?${q}` : base;
  };
  if (!empresa) {
    const { data: empresas } = await db.from("empresa").select("id, razao_social, cnpj, regime").eq("ativa", true).order("razao_social");
    return (
      <>
        <div className="cab"><div><h1>{aba === "tomadores" ? "Tomadores (clientes)" : "Serviços"}</h1><p>Escolha a empresa. Cada empresa tem os seus {aba === "tomadores" ? "tomadores" : "serviços"}.</p></div></div>
        <div className="cartao"><EscolhaEmpresa empresas={(empresas ?? []).map((x) => ({ id: x.id, titulo: x.razao_social, detalhe: `CNPJ ${documento(x.cnpj)} · ${x.regime}` }))} para={base} /></div>
      </>
    );
  }

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
  const fechar = url({ editar: undefined, novo: undefined });
  const janela = Boolean(edicao) || p.novo === "1";
  const qtd = `${linhas.length}${linhas.length === 200 ? "+" : ""} ${aba === "tomadores" ? (linhas.length === 1 ? "tomador" : "tomadores") : (linhas.length === 1 ? "serviço" : "serviços")}`;

  return (
    <>
      <div className="cab">
        <div>
          <h1>{aba === "tomadores" ? "Tomadores (clientes)" : "Serviços"}</h1>
          <p>{empresa.razao_social} · {qtd}{termo ? ` para “${termo}”` : ""}{aba === "servicos" && p.arquivados === "1" ? " arquivados" : ""}</p>
        </div>
        <div className="acoes"><Link className="botao" href={url({ novo: "1", editar: undefined })} scroll={false}>{aba === "tomadores" ? "+ Novo tomador" : "+ Novo serviço"}</Link></div>
      </div>

      <section className="cartao lista-cadastro">
        <form className="busca-linha" action={base}>
          {p.arquivados && <input type="hidden" name="arquivados" value={p.arquivados} />}
          <input name="q" defaultValue={p.q ?? ""} aria-label="Procurar" placeholder={aba === "tomadores" ? "Procurar por nome ou CPF/CNPJ" : "Procurar por nome, descrição ou código"} />
          <button type="submit" className="secundario">Procurar</button>
          {termo && <Link href={url({ q: undefined })}>Limpar</Link>}
          {aba === "servicos" && (p.arquivados === "1"
            ? <Link href={url({ arquivados: undefined })} className="dir">Ver ativos</Link>
            : <Link href={url({ arquivados: "1" })} className="dir suave">Ver arquivados</Link>)}
        </form>

        {aba === "tomadores" ? (
          <div className="tabela sem-borda">
            <table>
              <thead><tr><th>Nome</th><th>CPF/CNPJ</th><th>E-mail</th><th>Origem</th><th><span className="so-leitor">Ações</span></th></tr></thead>
              <tbody>
                {linhas.length === 0 && <tr><td colSpan={5} className="suave">Nenhum tomador{termo ? " encontrado" : " ainda"}. Use “+ Novo tomador”.</td></tr>}
                {linhas.map((t) => (
                  <tr key={s(t.id)}>
                    <td><Link href={url({ editar: s(t.id) })} scroll={false} className="nome-link">{s(t.nome)}</Link></td>
                    <td className="nowrap">{documento(s(t.documento))}</td>
                    <td className="suave">{s(t.email)}</td>
                    <td><span className={`etiqueta ${s(t.origem)}`}>{ORIGEM[s(t.origem)] ?? s(t.origem)}</span></td>
                    <td className="num">
                      <span className="acoes" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                        <Link className="botao mini secundario" href={url({ editar: s(t.id) })} scroll={false}>Editar</Link>
                        <Link className="botao mini" href={`/notas/nova?tomador=${s(t.id)}`}>Emitir</Link>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="tabela sem-borda">
            <table>
              <thead><tr><th>Serviço</th><th>Código</th><th className="num">Valor sugerido</th><th>Origem</th><th><span className="so-leitor">Ações</span></th></tr></thead>
              <tbody>
                {linhas.length === 0 && <tr><td colSpan={5} className="suave">Nenhum serviço{termo ? " encontrado" : " ainda"}. Use “+ Novo serviço”.</td></tr>}
                {linhas.map((x) => (
                  <tr key={s(x.id)}>
                    <td>
                      <Link href={url({ editar: s(x.id) })} scroll={false} className="nome-link">{s(x.nome) || s(x.descricao).slice(0, 60)}</Link>
                      {s(x.nome) && <span className="suave">{s(x.descricao).slice(0, 90)}{s(x.descricao).length > 90 ? "…" : ""}</span>}
                    </td>
                    <td className="nowrap"><span className="codigo">{codigoServico(s(x.codigo_tributacao_nacional))}</span></td>
                    <td className="num">{x.valor_padrao == null ? <span className="suave">—</span> : reais(x.valor_padrao as number)}</td>
                    <td><span className={`etiqueta ${s(x.origem)}`}>{ORIGEM[s(x.origem)] ?? s(x.origem)}</span></td>
                    <td className="num">
                      <span className="acoes" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                        <Link className="botao mini secundario" href={url({ editar: s(x.id) })} scroll={false}>Editar</Link>
                        {x.ativo && <Link className="botao mini" href={`/notas/nova?servico=${s(x.id)}`}>Emitir</Link>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="suave rodape-lista">
          {aba === "tomadores" ? "Os tomadores" : "Os serviços"} também entram sozinhos: das notas emitidas, da planilha e dos XMLs importados (envio de XML ou busca no ADN) em que a empresa é a prestadora.
        </p>
      </section>

      {janela && aba === "tomadores" && (
        <Janela titulo={edicao ? `Editar ${s(e.nome)}` : "Novo tomador"} fechar={fechar}>
          <Formulario key={s(e.id) || "novo"} acao={salvarTomador} className="grade" aoConcluir={fechar}
            botao={<><button type="submit">{edicao ? "Salvar" : "Cadastrar tomador"}</button><Link className="botao secundario" href={fechar} replace scroll={false}>Cancelar</Link></>}>
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
            <label className="largo">Logradouro<input name="logradouro" defaultValue={s(e.logradouro)} /></label>
            <label>Número<input name="numero" defaultValue={s(e.numero)} /></label>
            <label>Complemento<input name="complemento" defaultValue={s(e.complemento)} /></label>
            <label>Bairro<input name="bairro" defaultValue={s(e.bairro)} /></label>
          </Formulario>
          {edicao && (
            <div className="janela-pe">
              <Formulario acao={excluirTomador} aoConcluir={fechar} botao={<button type="submit" className="perigo">Excluir tomador</button>}>
                <input type="hidden" name="empresa_id" value={empresaId} />
                <input type="hidden" name="id" value={s(e.id)} />
              </Formulario>
            </div>
          )}
        </Janela>
      )}

      {janela && aba === "servicos" && (
        <Janela titulo={edicao ? "Editar serviço" : "Novo serviço"} fechar={fechar}>
          <Formulario key={s(e.id) || "novo"} acao={salvarServico} className="grade" aoConcluir={fechar}
            botao={<><button type="submit">{edicao ? "Salvar" : "Cadastrar serviço"}</button><Link className="botao secundario" href={fechar} replace scroll={false}>Cancelar</Link></>}>
            <input type="hidden" name="empresa_id" value={empresaId} />
            {edicao && <input type="hidden" name="id" value={s(e.id)} />}
            <label className="largo">Nome curto (para achar na lista)<input name="nome" defaultValue={s(e.nome)} placeholder="ex.: Honorários mensais" maxLength={120} /></label>
            <CamposServico codigo={s(e.codigo_tributacao_nacional) || undefined} nbs={s(e.codigo_nbs) || undefined} ibscbs={{ cclasstrib: s(e.cclasstrib), cindOp: s(e.cind_op), cativSn: s(e.cativ_sn) }} />
            <label className="largo">Descrição que vai na nota<textarea name="descricao" defaultValue={s(e.descricao)} required maxLength={2000} /></label>
            <label>Município da prestação<CampoMunicipio name="cod_municipio_prestacao" codigo={s(e.cod_municipio_prestacao)} /><span className="suave">Em branco: o da empresa.</span></label>
            <label>Valor sugerido (R$)<input name="valor_padrao" defaultValue={s(e.valor_padrao).replace(".", ",")} inputMode="decimal" /></label>
            <label>ISS retido pelo tomador<input name="iss_retido" type="checkbox" defaultChecked={Boolean(e.iss_retido)} /></label>
            <label>Alíquota ISS (%) se retido<input name="aliquota_iss" defaultValue={s(e.aliquota_iss).replace(".", ",")} inputMode="decimal" /></label>
            <p className="suave largo" style={{ margin: 0 }}>Retenções federais pelo tomador (%). Deixe vazio o que não for retido.</p>
            {TRIBUTOS_RETIDOS.map((t) => (
              <label key={t}>{ROTULO_RETENCAO[t]} (%)<input name={`ret_${t}`} defaultValue={s(e[`pct_ret_${t}`]).replace(".", ",")} inputMode="decimal" placeholder={`ex.: ${EXEMPLO_RETENCAO[t]}`} /></label>
            ))}
          </Formulario>
          {edicao && (
            <div className="janela-pe">
              <Formulario acao={arquivarServico} aoConcluir={fechar} botao={<button type="submit" className="secundario">{e.ativo ? "Arquivar serviço" : "Reativar serviço"}</button>}>
                <input type="hidden" name="empresa_id" value={empresaId} />
                <input type="hidden" name="id" value={s(e.id)} />
                <input type="hidden" name="ativo" value={e.ativo ? "false" : "true"} />
              </Formulario>
            </div>
          )}
        </Janela>
      )}
    </>
  );
}
