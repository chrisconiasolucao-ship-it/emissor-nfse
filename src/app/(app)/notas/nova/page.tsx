import { Formulario } from "@/components/formulario";
import { eEscritorio } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { competenciaAtual } from "@/lib/importacao/repetir-mes";
import { lerNfse, type ModeloNota } from "@/lib/nfse/nfse-parser";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServidor } from "@/lib/supabase/server";
import { salvarNota } from "../actions";

type Valores = Partial<Record<string, string>>;

/** Nota avulsa, a partir de nota anterior (?modelo=<nota>), de XML importado (?documento=<doc>) ou substituição (?substitui=<nota>). */
export default async function NovaNota({ searchParams }: { searchParams: Promise<{ empresa?: string; modelo?: string; documento?: string; substitui?: string; editar?: string }> }) {
  const perfil = await perfilAtual();
  const p = await searchParams;
  const db = await supabaseServidor();
  const { data: empresas } = await db.from("empresa").select("id, razao_social, cod_municipio").eq("ativa", true).order("razao_social");
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
        valor: n.valor_servico ?? "",
        aliquota_iss: n.aliquota_iss ?? "",
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
  const empresaId = v.empresa_id ?? empresaPadrao;
  const munPadrao = (empresas ?? []).find((e) => e.id === empresaId)?.cod_municipio ?? "";

  return (
    <>
      <h1>{titulo}</h1>
      <div className="cartao">
        <Formulario
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
          <label className="largo">Empresa (prestador)
            <select name="empresa_id" defaultValue={empresaId ?? ""} required>
              <option value="" disabled>Escolha</option>
              {(empresas ?? []).map((e) => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
            </select>
          </label>
          <label>Tomador
            <select name="tomador_tipo" defaultValue={v.tomador_tipo ?? "CPF"}><option value="CPF">CPF</option><option value="CNPJ">CNPJ</option></select>
          </label>
          <label>CPF/CNPJ<input name="tomador_documento" defaultValue={v.tomador_documento} required /></label>
          <label className="largo">Nome do tomador<input name="tomador_nome" defaultValue={v.tomador_nome} required /></label>
          <label>E-mail<input name="tomador_email" type="email" defaultValue={v.tomador_email} /></label>
          <label>CEP<input name="tomador_cep" defaultValue={v.tomador_cep} /></label>
          <label>Município do tomador (IBGE)<input name="tomador_cod_municipio" defaultValue={v.tomador_cod_municipio} /></label>
          <label>Logradouro<input name="tomador_logradouro" defaultValue={v.tomador_logradouro} /></label>
          <label>Número<input name="tomador_numero" defaultValue={v.tomador_numero} /></label>
          <label>Complemento<input name="tomador_complemento" defaultValue={v.tomador_complemento} /></label>
          <label>Bairro<input name="tomador_bairro" defaultValue={v.tomador_bairro} /></label>
          <label>Cód. tributação nacional<input name="codigo_tributacao_nacional" defaultValue={v.codigo_tributacao_nacional} required pattern="\d{6}" /></label>
          <label>NBS<input name="codigo_nbs" defaultValue={v.codigo_nbs} pattern="\d{9}" /></label>
          <label>Município da prestação (IBGE)<input name="cod_municipio_prestacao" defaultValue={v.cod_municipio_prestacao || munPadrao} required pattern="\d{7}" /></label>
          <label className="largo">Descrição do serviço<textarea name="descricao" defaultValue={v.descricao} required maxLength={2000} /></label>
          <label>Valor (R$)<input name="valor" defaultValue={v.valor?.replace(".", ",")} required inputMode="decimal" /></label>
          <label>Competência<input name="competencia" type="month" defaultValue={v.competencia} required /></label>
          <label>ISS retido pelo tomador<input name="iss_retido" type="checkbox" defaultChecked={retido} /></label>
          <label>Alíquota ISS (%) se retido<input name="aliquota_iss" defaultValue={v.aliquota_iss} inputMode="decimal" /></label>
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
      </div>
    </>
  );
}
