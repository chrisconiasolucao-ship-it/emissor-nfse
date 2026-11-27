import { Suspense } from "react";
import { CampoMunicipio } from "@/components/campo-municipio";
import { PassosNota, type Escolhido } from "@/components/passos-nota";
import { CamposServico } from "@/components/campos-servico";
import { Formulario } from "@/components/formulario";
import { eEscritorio } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { empresaAtual } from "@/lib/empresa-atual";
import { competenciaAtual } from "@/lib/importacao/repetir-mes";
import { lerNfse, type ModeloNota } from "@/lib/nfse/nfse-parser";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { reais } from "@/lib/money";
import { codigoServico, documento } from "@/lib/formato";
import { supabaseServidor } from "@/lib/supabase/server";
import { calcularNota, EXEMPLO_RETENCAO, lerPercentual, percentuaisDaLinha, ROTULO_RETENCAO, TRIBUTOS_RETIDOS, type PercentuaisRetencao } from "@/lib/nfse/retencoes";
import { salvarNota } from "../actions";

/** pct_ret_* do banco → campos ret_* do formulário ("11,00") */
function retencoesTela(l: Record<string, unknown>): Valores {
  const pct = percentuaisDaLinha(l);
  return Object.fromEntries(TRIBUTOS_RETIDOS.map((t) => [`ret_${t}`, pct[t] ? pct[t]!.replace(".", ",") : ""]));
}

/** Líquido para o resumo; vazio se algum campo ainda não fecha. */
function liquidoResumo(v: Valores, retido: boolean): string | null {
  try {
    if (!v.valor) return null;
    const pct: PercentuaisRetencao = {};
    for (const t of TRIBUTOS_RETIDOS) pct[t] = lerPercentual(v[`ret_${t}`] ?? "");
    return calcularNota({ valorServico: v.valor, issRetido: retido, aliquotaIss: retido ? v.aliquota_iss : null, pct }).valorLiquido;
  } catch {
    return null;
  }
}

type Valores = Partial<Record<string, string>>;

/** Nota avulsa, a partir de nota anterior (?modelo=<nota>), de XML importado (?documento=<doc>) ou substituição (?substitui=<nota>). */
export default async function NovaNota({ searchParams }: { searchParams: Promise<{ empresa?: string; modelo?: string; documento?: string; substitui?: string; editar?: string; tomador?: string; servico?: string; tdoc?: string; tnome?: string; scod?: string; sdesc?: string }> }) {
  const perfil = await perfilAtual();
  const busca = await searchParams;
  // a empresa aberta no menu já é o passo 1
  const aberta = await empresaAtual(perfil);
  const p = { ...busca, empresa: busca.empresa ?? aberta?.id };
  const db = await supabaseServidor();
  const { data: empresas } = await db.from("empresa").select("id, razao_social, cnpj, regime, cod_municipio, regime_iss").eq("ativa", true).order("razao_social");
  const empresaPadrao = p.empresa ?? (eEscritorio(perfil) ? undefined : (perfil.empresaId ?? undefined));
  let v: Valores = { competencia: competenciaAtual().slice(0, 7) };
  let retido = false;
  let origem: "avulsa" | "modelo" = "avulsa";
  let titulo = "Nova nota";

  const deNota = p.editar ?? p.modelo ?? p.substitui;
  if (deNota) {
    const { data: n } = await db.from("nota").select("*, tomador:tomador(*)").eq("id", deNota).maybeSingle();
    if (n) {
      const t = (n.tomador ?? {}) as Record<string, string | null>;
      v = {
        ...v,
        empresa_id: n.empresa_id,
        tomador_tipo: t.tipo_documento ?? "CPF",
        tomador_documento: t.documento ?? "",
        tomador_nome: t.nome ?? "",
        tomador_email: t.email ?? "",
        tomador_cep: t.cep ?? "",
        tomador_cod_municipio: t.cod_municipio ?? "",
        tomador_logradouro: t.logradouro ?? "",
        tomador_numero: t.numero ?? "",
        tomador_complemento: t.complemento ?? "",
        tomador_bairro: t.bairro ?? "",
        codigo_tributacao_nacional: n.codigo_tributacao_nacional ?? "",
        codigo_nbs: n.codigo_nbs ?? "",
        descricao: n.descricao,
        cod_municipio_prestacao: n.cod_municipio_prestacao ?? "",
        valor: n.valor_servico == null ? "" : String(n.valor_servico),
        aliquota_iss: n.aliquota_iss == null ? "" : String(n.aliquota_iss),
        ...retencoesTela(n),
      };
      retido = Boolean(n.iss_retido);
      if (p.editar) {
        v.id = n.id;
        v.competencia = n.competencia?.slice(0, 7) ?? v.competencia;
        titulo = "Editar rascunho";
      } else origem = "modelo";
      if (p.substitui) titulo = `Substituir a NFS-e ${n.numero_nfse ?? ""}`;
    }
  } else if (p.documento) {
    // XML importado (ADN ou upload): lido no servidor, depois de a RLS confirmar que o usuário vê o documento
    const { data: doc } = await db.from("documento").select("empresa_id, storage_path").eq("id", p.documento).maybeSingle();
    if (doc) {
      const arq = await supabaseAdmin().storage.from("documentos").download(doc.storage_path);
      if (arq.data) {
        try {
          const m: ModeloNota = lerNfse(await arq.data.text());
          origem = "modelo";
          v = {
            ...v,
            empresa_id: doc.empresa_id,
            documento_origem_id: p.documento,
            tomador_tipo: m.tomador?.tipoDocumento === "CNPJ" ? "CNPJ" : "CPF",
            tomador_documento: m.tomador?.documento ?? "",
            tomador_nome: m.tomador?.nome ?? "",
            tomador_email: m.tomador?.email ?? "",
            tomador_cep: m.tomador?.endereco?.cep ?? "",
            tomador_cod_municipio: m.tomador?.endereco?.codMunicipio ?? "",
            tomador_logradouro: m.tomador?.endereco?.logradouro ?? "",
            tomador_numero: m.tomador?.endereco?.numero ?? "",
            tomador_bairro: m.tomador?.endereco?.bairro ?? "",
            codigo_tributacao_nacional: m.servico.codigoTributacaoNacional,
            codigo_nbs: m.servico.codigoNbs ?? "",
            descricao: m.servico.descricao,
            cod_municipio_prestacao: m.servico.codMunicipioPrestacao ?? "",
            valor: m.valorServico,
            aliquota_iss: m.aliquotaIss ?? "",
          };
          retido = m.issRetido;
          titulo = `Nova nota a partir da NFS-e ${m.numeroNfse ?? ""}`;
        } catch {
          /* XML fora do padrão: formulário em branco */
        }
      }
    }
  }
  // cadastros salvos escolhidos no topo da tela (?tomador=<id>&servico=<id>) preenchem por cima
  let tomadorEsc: Escolhido = null;
  let servicoEsc: Escolhido = null;
  let servicoId: string | undefined;
  if (p.tomador === "novo" && p.empresa) {
    const doc = (p.tdoc ?? "").replace(/\D/g, "");
    v = { ...v, empresa_id: p.empresa, tomador_tipo: doc.length === 14 ? "CNPJ" : "CPF", tomador_documento: doc, tomador_nome: p.tnome ?? "" };
    tomadorEsc = { titulo: "Novo tomador", detalhe: "Preencha os dados abaixo. Ele fica salvo nos cadastros da empresa ao emitir.", novo: true };
  } else if (p.tomador && p.empresa) {
    const { data: t } = await db.from("tomador").select("*").eq("empresa_id", p.empresa).eq("id", p.tomador).maybeSingle();
    if (t) {
      v = {
        ...v,
        empresa_id: p.empresa,
        tomador_tipo: t.tipo_documento === "CNPJ" ? "CNPJ" : "CPF",
        tomador_documento: t.documento ?? "",
        tomador_nome: t.nome ?? "",
        tomador_email: t.email ?? "",
        tomador_cep: t.cep ?? "",
        tomador_cod_municipio: t.cod_municipio ?? "",
        tomador_logradouro: t.logradouro ?? "",
        tomador_numero: t.numero ?? "",
        tomador_complemento: t.complemento ?? "",
        tomador_bairro: t.bairro ?? "",
      };
      tomadorEsc = { titulo: t.nome, detalhe: `${t.tipo_documento} ${documento(t.documento)}`, origem: t.origem ?? undefined };
    }
  }
  if (p.servico === "novo" && p.empresa) {
    v = { ...v, empresa_id: p.empresa, codigo_tributacao_nacional: p.scod ?? "", descricao: p.sdesc ?? "" };
    servicoEsc = { titulo: "Novo serviço", detalhe: "Informe o código de tributação e a descrição abaixo. Ele fica salvo nos serviços da empresa.", novo: true };
  } else if (p.servico && p.empresa) {
    const { data: sv } = await db.from("servico").select("*").eq("empresa_id", p.empresa).eq("id", p.servico).maybeSingle();
    if (sv) {
      v = {
        ...v,
        empresa_id: p.empresa,
        codigo_tributacao_nacional: sv.codigo_tributacao_nacional ?? "",
        codigo_nbs: sv.codigo_nbs ?? "",
        descricao: sv.descricao ?? "",
        cod_municipio_prestacao: sv.cod_municipio_prestacao ?? v.cod_municipio_prestacao ?? "",
        valor: sv.valor_padrao == null ? v.valor : String(sv.valor_padrao),
        aliquota_iss: sv.aliquota_iss == null ? "" : String(sv.aliquota_iss),
        ...retencoesTela(sv),
      };
      retido = Boolean(sv.iss_retido);
      servicoId = String(sv.id);
      const cod = String(sv.codigo_tributacao_nacional ?? "");
      servicoEsc = { titulo: sv.nome || String(sv.descricao).slice(0, 80), codigo: codigoServico(cod), detalhe: sv.valor_padrao != null ? `valor padrão ${reais(sv.valor_padrao)}` : "sem valor padrão, informe o valor", origem: sv.origem ?? undefined };
    }
  }
  const unica = !eEscritorio(perfil) && (empresas ?? []).length === 1 ? empresas![0]!.id : undefined;
  const empresaId = v.empresa_id ?? empresaPadrao ?? unica;
  const emp = (empresas ?? []).find((e) => e.id === empresaId);
  const munPadrao = emp?.cod_municipio ?? "";
  // ISS fixo (sociedade de profissionais): o ISS não é calculado nem retido na nota
  const issFixo = emp?.regime_iss === "sociedade_profissionais";
  if (issFixo) retido = false;
  const liquido = liquidoResumo(v, retido);
  const travado = Boolean(deNota || p.documento);
  if (travado && v.tomador_nome) tomadorEsc = { titulo: v.tomador_nome, detalhe: `${v.tomador_tipo} ${documento(v.tomador_documento)}` };
  if (travado && v.descricao) servicoEsc = { titulo: v.descricao.slice(0, 80), codigo: codigoServico(v.codigo_tributacao_nacional) };
  // o formulário aparece quando os três passos estão resolvidos (ou quando a nota vem de outra)
  const pronto = Boolean(emp && (travado || (tomadorEsc && servicoEsc)));
  const falta = !emp ? "a empresa" : !tomadorEsc && !servicoEsc ? "o tomador e o serviço" : !tomadorEsc ? "o tomador" : "o serviço";

  return (
    <>
      <div className="cab">
        <div>
          <h1>{titulo}</h1>
          <p>{travado ? "Os dados vêm da nota de origem. Confira e ajuste antes de emitir." : `${aberta ? "Escolha" : "Escolha a empresa, depois"} o tomador e o serviço. Clique na lista ou digite para buscar.`}</p>
        </div>
      </div>
      <div className="duas">
        <div className="pilha">
          <Suspense>
            <PassosNota
              empresas={(empresas ?? []).map((e) => ({ id: e.id, titulo: e.razao_social, detalhe: `CNPJ ${documento(e.cnpj)} · ${e.regime}` }))}
              empresaId={emp?.id}
              empresa={emp ? { titulo: emp.razao_social, detalhe: `CNPJ ${documento(emp.cnpj)} · ${emp.regime}` } : null}
              tomador={tomadorEsc}
              servico={servicoEsc}
              trocarEmpresa={!aberta && (eEscritorio(perfil) || (empresas ?? []).length > 1)}
              travado={travado}
            />
          </Suspense>
          {pronto && (
      <section className="cartao" aria-labelledby="t-dados">
        <div className="cartao-cab"><h2 id="t-dados" style={{ margin: 0 }}>Dados da nota</h2><span className="suave">Tudo pode ser ajustado antes de emitir.</span></div>
        <Formulario
          key={JSON.stringify(p)}
          acao={salvarNota}
          className="grade"
          botao={
            <>
              <button type="submit" name="acao" value="emitir">Emitir</button>
              <button type="submit" name="acao" value="rascunho" className="secundario">Salvar rascunho</button>
            </>
          }
        >
          {v.id && <input type="hidden" name="id" value={v.id} />}
          <input type="hidden" name="origem" value={origem} />
          {v.documento_origem_id && <input type="hidden" name="documento_origem_id" value={v.documento_origem_id} />}
          <input type="hidden" name="empresa_id" value={emp?.id ?? ""} />
          <label>Tomador
            <select name="tomador_tipo" defaultValue={v.tomador_tipo ?? "CPF"}><option value="CPF">CPF</option><option value="CNPJ">CNPJ</option></select>
          </label>
          <label>CPF/CNPJ<input name="tomador_documento" defaultValue={v.tomador_documento} required /></label>
          <label className="largo">Nome do tomador<input name="tomador_nome" defaultValue={v.tomador_nome} required /></label>
          <label>E-mail<input name="tomador_email" type="email" defaultValue={v.tomador_email} /></label>
          <label>CEP<input name="tomador_cep" defaultValue={v.tomador_cep} /></label>
          <label>Município do tomador<CampoMunicipio name="tomador_cod_municipio" codigo={v.tomador_cod_municipio} /></label>
          <label>Logradouro<input name="tomador_logradouro" defaultValue={v.tomador_logradouro} /></label>
          <label>Número<input name="tomador_numero" defaultValue={v.tomador_numero} /></label>
          <label>Complemento<input name="tomador_complemento" defaultValue={v.tomador_complemento} /></label>
          <label>Bairro<input name="tomador_bairro" defaultValue={v.tomador_bairro} /></label>
          <CamposServico codigo={v.codigo_tributacao_nacional} nbs={v.codigo_nbs} />
          <label>Município da prestação<CampoMunicipio name="cod_municipio_prestacao" codigo={v.cod_municipio_prestacao || munPadrao} required /></label>
          <label className="largo">Descrição do serviço<textarea name="descricao" defaultValue={v.descricao} required maxLength={2000} /></label>
          <label>Valor (R$)<input name="valor" defaultValue={v.valor?.replace(".", ",")} required inputMode="decimal" /></label>
          <label>Competência<input name="competencia" type="month" defaultValue={v.competencia} required /></label>
          {issFixo ? (
            <p className="msg alerta largo" style={{ margin: 0 }}>ISS fixo (sociedade de profissionais): o ISS não é calculado nesta nota e o tomador não retém ISS.</p>
          ) : (
            <>
              <label>ISS retido pelo tomador<input name="iss_retido" type="checkbox" defaultChecked={retido} /></label>
              <label>Alíquota ISS (%) se retido<input name="aliquota_iss" defaultValue={v.aliquota_iss} inputMode="decimal" /></label>
            </>
          )}
          <fieldset className="largo grade" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="suave">Retenções federais pelo tomador (%) · deixe vazio o que não for retido</legend>
            {TRIBUTOS_RETIDOS.map((t) => (
              <label key={t}>{ROTULO_RETENCAO[t]} (%)<input name={`ret_${t}`} defaultValue={v[`ret_${t}`]} inputMode="decimal" placeholder={`ex.: ${EXEMPLO_RETENCAO[t]}`} /></label>
            ))}
          </fieldset>
          {servicoId ? (
            <input type="hidden" name="servico_id" value={servicoId} />
          ) : (
            <label>Guardar este serviço nos cadastros<input name="guardar_servico" type="checkbox" defaultChecked={!v.id} /></label>
          )}
          {p.substitui && (
            <>
              <input type="hidden" name="nota_substituida_id" value={p.substitui} />
              <label>Motivo da substituição
                <select name="codigo_motivo_substituicao" defaultValue="99" required>
                  <option value="01">01 · Desenquadramento do Simples</option>
                  <option value="02">02 · Enquadramento no Simples</option>
                  <option value="03">03 · Inclusão retroativa de imunidade/isenção</option>
                  <option value="04">04 · Exclusão retroativa de imunidade/isenção</option>
                  <option value="05">05 · Rejeição pelo tomador</option>
                  <option value="99">99 · Outros</option>
                </select>
              </label>
              <label className="largo">Explique o motivo (mínimo 15 caracteres)<input name="motivo_substituicao" minLength={15} maxLength={255} required /></label>
            </>
          )}
        </Formulario>
      </section>
          )}
        </div>
        <aside className="cartao resumo" aria-labelledby="t-resumo">
          <h2 id="t-resumo" style={{ margin: 0 }}>Resumo</h2>
          <div className="total">{v.valor ? reais(v.valor) : "R$ 0,00"}</div>
          <div className="linha"><span className="suave">Empresa</span><span>{emp?.razao_social ?? "—"}</span></div>
          <div className="linha"><span className="suave">Tomador</span><span>{tomadorEsc?.novo ? "novo" : (tomadorEsc?.titulo ?? "—")}</span></div>
          <div className="linha"><span className="suave">Serviço</span><span>{servicoEsc?.novo ? "novo" : (servicoEsc?.codigo || servicoEsc?.titulo || "—")}</span></div>
          <div className="linha"><span className="suave">ISS</span><span>{issFixo ? "fixo (sociedade de profissionais)" : retido ? "retido pelo tomador" : "no DAS"}</span></div>
          <div className="linha"><span className="suave">Valor líquido</span><span>{liquido ? reais(liquido) : "—"}</span></div>
          <p className="msg alerta" style={{ margin: 0, fontSize: 13 }} hidden={pronto}>Falta escolher {falta}.</p>
          <p className="suave" style={{ margin: 0 }} hidden={!pronto}>Os botões Emitir e Salvar rascunho ficam no fim do formulário.</p>
        </aside>
      </div>
    </>
  );
}
