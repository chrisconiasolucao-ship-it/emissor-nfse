import Link from "next/link";
import { redirect } from "next/navigation";
import { CampoCnpj } from "@/components/campo-cnpj";
import { CampoMunicipio } from "@/components/campo-municipio";
import { CamposIbsCbsEmpresa } from "@/components/campos-ibscbs-empresa";
import { Formulario } from "@/components/formulario";
import { podeGerirEmpresas } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { salvarEmpresa } from "../actions";
import { CadastroPeloCertificado } from "../cadastro-certificado";

/** Cadastro de empresa nova (só escritório): pelo certificado A1 ou à mão. */
export default async function NovaEmpresa() {
  const perfil = await perfilAtual();
  if (!podeGerirEmpresas(perfil)) redirect("/empresas");
  return (
    <>
      <div className="cab">
        <div><h1>Cadastrar empresa</h1><p>Pelo certificado A1 (mais rápido) ou digitando os dados.</p></div>
        <div className="acoes"><Link className="botao secundario" href="/empresas">Voltar para Empresas</Link></div>
      </div>

      <h2>Cadastrar pelo certificado</h2>
      <p className="suave">Envie o A1 (.pfx) da empresa. CNPJ e razão social saem do certificado; município e regime vêm da consulta pública do CNPJ. Você confere antes de gravar, e o certificado já fica guardado.</p>
      <div className="cartao">
        <CadastroPeloCertificado />
      </div>
      <h2>Cadastrar à mão</h2>
      <div className="cartao">
        <Formulario acao={salvarEmpresa} className="grade" botao={<button type="submit">Cadastrar</button>}>
          <label>CNPJ<CampoCnpj name="cnpj" required municipio="cod_municipio"
            campos={{ razao_social: "razao_social", nome_fantasia: "nome_fantasia", regime: "regime", cod_municipio: "cod_municipio", email: "email", telefone: "telefone" }} /></label>
          <label className="largo">Razão social<input name="razao_social" required /></label>
          <label>Nome fantasia<input name="nome_fantasia" /></label>
          <label>Regime
            <select name="regime" required defaultValue="ME">
              <option value="ME">Simples Nacional — ME</option>
              <option value="EPP">Simples Nacional — EPP</option>
              <option value="MEI">MEI</option>
            </select>
          </label>
          <label>Município<CampoMunicipio name="cod_municipio" required /></label>
          <label>Inscrição municipal<input name="inscricao_municipal" /></label>
          <label>E-mail<input name="email" type="email" /></label>
          <label>Telefone<input name="telefone" /></label>
          <label>Série da DPS<input name="serie_dps" defaultValue="900" pattern="\d{1,5}" /></label>
          <label>Alíquota do Simples (%)<input name="aliquota_simples" inputMode="decimal" placeholder="ex.: 6,00" defaultValue="" /><span className="suave">ME/EPP: vai na nota como percentual aproximado de tributos.</span></label>
            <label>Regime do ISS<select name="regime_iss" defaultValue="normal"><option value="normal">Normal (ISS pela alíquota, no DAS ou retido)</option><option value="sociedade_profissionais">ISS fixo · sociedade de profissionais</option></select><span className="suave">ISS fixo: a nota sai sem alíquota e sem ISS retido.</span></label>
            <CamposIbsCbsEmpresa />
        </Formulario>
      </div>
            </>
  );
}
