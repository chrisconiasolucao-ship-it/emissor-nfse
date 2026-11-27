import Link from "next/link";
import { reais } from "@/lib/money";
import { codigoServico, documento } from "@/lib/formato";
import { notFound } from "next/navigation";
import { AcompanharNota } from "@/components/acompanhar-nota";
import { Formulario } from "@/components/formulario";
import { podeCancelarOuSubstituir } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { supabaseServidor } from "@/lib/supabase/server";
import { cancelarNota, emitirRascunho, excluirRascunho } from "../actions";

const ROTULO: Record<string, string> = { rascunho: "Rascunho", na_fila: "Na fila", enviando: "Enviando", autorizada: "Autorizada", rejeitada: "Rejeitada", cancelada: "Cancelada", substituida: "Substituída" };

/** Autorizada há menos de 10 minutos. */
function recente(iso: string | null): boolean {
  return iso != null && Date.now() - new Date(iso).getTime() < 10 * 60 * 1000;
}

export default async function Nota({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const perfil = await perfilAtual();
  const db = await supabaseServidor();
  const { data: n } = await db.from("nota").select("*, empresa:empresa_id(razao_social, cnpj), tomador:tomador(nome, documento)").eq("id", id).maybeSingle();
  if (!n) notFound();
  const [{ data: docs }, { data: eventos }] = await Promise.all([
    db.from("documento").select("id, tipo, criado_em").eq("empresa_id", n.empresa_id).or(`nota_id.eq.${id},id.eq.${n.documento_id ?? "00000000-0000-0000-0000-000000000000"}`),
    db.from("evento_nota").select("tipo, motivo, registrado_em, nota_substituta_id").eq("empresa_id", n.empresa_id).eq("nota_id", id),
  ]);
  const empresa = n.empresa as unknown as { razao_social: string; cnpj: string };
  const tomador = n.tomador as unknown as { nome: string; documento: string } | null;
  const pode = podeCancelarOuSubstituir(perfil, n.empresa_id);
  const docRotulo = (t: string) => (t === "danfse" ? "Baixar DANFSe" : t === "xml_autorizado" ? "XML autorizado" : t === "xml_evento" ? "XML do evento" : t);
  const quando = (d: string | null) => (d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : null);
  const naFila = n.situacao === "na_fila" || n.situacao === "enviando";
  // o DANFSe é gerado logo depois da autorização; acompanha só por 10 minutos depois dela
  const semDanfse = n.situacao === "autorizada" && !(docs ?? []).some((d) => d.tipo === "danfse") && recente(n.autorizada_em);
  const ordenados = [...(docs ?? [])].sort((a, b) => (a.tipo === "danfse" ? -1 : b.tipo === "danfse" ? 1 : 0));
  return (
    <>
      <section className="cartao nota-topo">
        <div>
          <span className="suave">{n.numero_nfse ? `NFS-e nº ${n.numero_nfse}` : "Nota sem número"} · {empresa.razao_social}</span>
          <div className="valor">{reais(n.valor_servico)}</div>
          <span className={`selo ${n.situacao}`}>{ROTULO[n.situacao]}{n.situacao === "autorizada" && n.autorizada_em ? ` em ${quando(n.autorizada_em)}` : ""}</span>
        </div>
        <div className="acoes">
          {ordenados.map((d, i) => (
            <a key={d.id} className={`botao${i === 0 && d.tipo === "danfse" ? "" : " secundario"}`} href={`/api/documentos/${d.id}`}>{docRotulo(d.tipo)}</a>
          ))}
          <Link className="botao secundario" href={`/notas/nova?modelo=${id}`}>Emitir outra igual</Link>
          {(n.situacao === "rascunho" || n.situacao === "rejeitada") && <Link className="botao" href={`/notas/nova?editar=${id}`}>{n.situacao === "rejeitada" ? "Corrigir e reenviar" : "Editar"}</Link>}
          {n.situacao === "autorizada" && pode && <Link className="botao secundario" href={`/notas/nova?substitui=${id}`}>Substituir</Link>}
        </div>
      </section>

      {naFila && <AcompanharNota texto={n.situacao === "enviando" ? "Enviando para a Receita. A tela atualiza sozinha quando ela responder." : "Na fila de emissão. A tela atualiza sozinha quando a Receita responder."} />}
      {semDanfse && <AcompanharNota texto="Nota autorizada. Gerando o DANFSe em PDF…" />}

      {n.motivo_rejeicao && <div className={`msg ${n.situacao === "rejeitada" ? "erro" : "alerta"}`}>{n.motivo_rejeicao}</div>}

      {(eventos ?? []).map((e, i) => (
        <div key={i} className="msg alerta">
          {e.tipo === "cancelamento" ? "Cancelada" : "Substituída"} em {quando(e.registrado_em)}: {e.motivo}
          {e.nota_substituta_id && <> · <Link href={`/notas/${e.nota_substituta_id}`}>abrir a nota nova</Link></>}
        </div>
      ))}

      <div className="blocos">
        <section className="cartao"><div className="cartao-cab"><h3>Prestador</h3></div>
          <dl><dt>Razão social</dt><dd>{empresa.razao_social}</dd><dt>CNPJ</dt><dd>{documento(empresa.cnpj)}</dd></dl>
        </section>
        <section className="cartao"><div className="cartao-cab"><h3>Tomador</h3></div>
          {tomador ? <dl><dt>Nome</dt><dd>{tomador.nome}</dd><dt>CPF/CNPJ</dt><dd>{documento(tomador.documento)}</dd></dl> : <p className="suave" style={{ margin: 0 }}>Sem tomador identificado.</p>}
        </section>
        <section className="cartao"><div className="cartao-cab"><h3>Serviço</h3></div>
          <dl>
            {n.codigo_tributacao_nacional && <><dt>Código</dt><dd><span className="codigo">{codigoServico(n.codigo_tributacao_nacional)}</span>{n.codigo_nbs ? <span className="suave"> · NBS {n.codigo_nbs}</span> : null}</dd></>}
            <dt>Descrição</dt><dd>{n.descricao}</dd>
            <dt>Competência</dt><dd>{n.competencia ? `${n.competencia.slice(5, 7)}/${n.competencia.slice(0, 4)}` : "—"}</dd>
          </dl>
        </section>
        <section className="cartao"><div className="cartao-cab"><h3>Valores</h3></div>
          <dl>
            <dt>Valor do serviço</dt><dd className="num" style={{ textAlign: "left" }}><b>{reais(n.valor_servico)}</b></dd>
            <dt>ISS</dt><dd>{n.iss_retido ? `retido pelo tomador (${n.aliquota_iss}%)` : "não retido (recolhido no DAS)"}</dd>
            {n.valor_liquido != null && <><dt>Valor líquido</dt><dd className="num" style={{ textAlign: "left" }}>{reais(n.valor_liquido)}</dd></>}
          </dl>
        </section>
      </div>

      {(n.chave_acesso || n.id_dps) && (
        <section className="cartao"><div className="cartao-cab"><h3>Identificação na Receita</h3></div>
          <dl>
            {n.chave_acesso && <><dt>Chave de acesso</dt><dd className="codigo" style={{ color: "var(--texto)" }}>{n.chave_acesso}</dd></>}
            {n.id_dps && <><dt>DPS</dt><dd>{n.id_dps} · {n.tentativas} {n.tentativas === 1 ? "tentativa" : "tentativas"} de envio</dd></>}
          </dl>
        </section>
      )}

      {n.situacao === "rascunho" && (
        <div className="acoes">
          <Formulario acao={emitirRascunho} botao={<button type="submit">Emitir este rascunho</button>}>
            <input type="hidden" name="empresa_id" value={n.empresa_id} />
            <input type="hidden" name="id" value={id} />
          </Formulario>
          <form action={excluirRascunho}>
            <input type="hidden" name="empresa_id" value={n.empresa_id} />
            <input type="hidden" name="id" value={id} />
            <button className="perigo" type="submit">Excluir rascunho</button>
          </form>
        </div>
      )}

      {n.situacao === "autorizada" && pode && (
        <>
          <div className="cartao">
            <div className="cartao-cab"><h3>Cancelar esta nota</h3><span className="suave">O cancelamento é enviado à Receita e não pode ser desfeito.</span></div>
            <Formulario acao={cancelarNota} className="grade" botao={<button className="perigo" type="submit">Cancelar nota na Receita</button>}>
              <input type="hidden" name="empresa_id" value={n.empresa_id} />
              <input type="hidden" name="id" value={id} />
              <label>Código
                <select name="codigo_motivo" defaultValue="1">
                  <option value="1">1 · Erro na emissão</option>
                  <option value="2">2 · Serviço não prestado</option>
                  <option value="9">9 · Outros</option>
                </select>
              </label>
              <label className="largo">Motivo (mínimo 15 caracteres)<input name="motivo" minLength={15} maxLength={255} required /></label>
            </Formulario>
          </div>
        </>
      )}
    </>
  );
}

