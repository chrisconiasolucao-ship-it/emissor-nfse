import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/components/formulario";
import { podeCancelarOuSubstituir } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { supabaseServidor } from "@/lib/supabase/server";
import { cancelarNota, emitirRascunho, excluirRascunho } from "../actions";

const ROTULO: Record<string, string> = { rascunho: "Rascunho", na_fila: "Na fila", enviando: "Enviando", autorizada: "Autorizada", rejeitada: "Rejeitada", cancelada: "Cancelada", substituida: "Substituída" };

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
  return (
    <>
      <h1>Nota {n.numero_nfse ? `nº ${n.numero_nfse}` : ""} <span className={`selo ${n.situacao}`}>{ROTULO[n.situacao]}</span></h1>
      {n.motivo_rejeicao && <div className={`msg ${n.situacao === "rejeitada" ? "erro" : "alerta"}`}>{n.motivo_rejeicao}</div>}
      <div className="cartao">
        <p><strong>{empresa.razao_social}</strong> ({empresa.cnpj}) → {tomador ? `${tomador.nome} (${tomador.documento})` : "sem tomador"}</p>
        <p>{n.descricao}</p>
        <p>Valor: R$ {String(n.valor_servico ?? "—").replace(".", ",")} · Competência: {n.competencia?.slice(0, 7)} · ISS {n.iss_retido ? `retido (${n.aliquota_iss}%)` : "não retido"}</p>
        {n.chave_acesso && <p className="suave">Chave de acesso: {n.chave_acesso}</p>}
        {n.id_dps && <p className="suave">DPS: {n.id_dps} · tentativas: {n.tentativas}</p>}
      </div>

      {(docs ?? []).length > 0 && (
        <>
          <h2>Arquivos</h2>
          <div className="acoes">
            {(docs ?? []).map((d) => (
              <a key={d.id} href={`/api/documentos/${d.id}`}>{d.tipo === "danfse" ? "DANFSe (PDF)" : d.tipo === "xml_autorizado" ? "XML autorizado" : d.tipo === "xml_evento" ? "XML do evento" : d.tipo}</a>
            ))}
          </div>
        </>
      )}

      {(eventos ?? []).map((e, i) => (
        <div key={i} className="msg alerta">
          {e.tipo === "cancelamento" ? "Cancelada" : "Substituída"} em {new Date(e.registrado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}: {e.motivo}
          {e.nota_substituta_id && <> · <Link href={`/notas/${e.nota_substituta_id}`}>nota nova</Link></>}
        </div>
      ))}

      <div className="acoes" style={{ marginTop: 16 }}>
        <Link href={`/notas/nova?modelo=${id}`}>Usar como modelo</Link>
        {(n.situacao === "rascunho" || n.situacao === "rejeitada") && <Link href={`/notas/nova?editar=${id}`}>Editar</Link>}
        {n.situacao === "autorizada" && pode && <Link href={`/notas/nova?substitui=${id}`}>Substituir</Link>}
      </div>

      {n.situacao === "rascunho" && (
        <div className="acoes" style={{ marginTop: 12 }}>
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
          <h2>Cancelar</h2>
          <div className="cartao">
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

