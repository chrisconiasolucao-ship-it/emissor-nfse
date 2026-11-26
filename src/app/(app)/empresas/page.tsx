import Link from "next/link";
import { Formulario } from "@/components/formulario";
import { eEscritorio } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { supabaseServidor } from "@/lib/supabase/server";
import { salvarEmpresa } from "./actions";
import { CadastroPeloCertificado } from "./cadastro-certificado";
import { CampoMunicipio } from "@/components/campo-municipio";

export default async function Empresas() {
  const perfil = await perfilAtual();
  const db = await supabaseServidor();
  const { data } = await db.from("empresa").select("id, razao_social, cnpj, regime, pausada, ativa").order("razao_social");
  return (
    <>
      <h1>Empresas</h1>
      <div className="tabela">
        <table>
          <thead><tr><th>Razão social</th><th>CNPJ</th><th>Regime</th><th>Situação</th></tr></thead>
          <tbody>
            {(data ?? []).map((e) => (
              <tr key={e.id}>
                <td><Link href={`/empresas/${e.id}`}>{e.razao_social}</Link></td>
                <td>{e.cnpj}</td><td>{e.regime}</td>
                <td>{!e.ativa ? "inativa" : e.pausada ? "pausada" : "ativa"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {eEscritorio(perfil) && (
        <>
          <h2>Cadastrar pelo certificado</h2>
          <p className="suave">Envie o A1 (.pfx) da empresa. CNPJ e razão social saem do certificado; município e regime vêm da consulta pública do CNPJ. Você confere antes de gravar, e o certificado já fica guardado.</p>
          <div className="cartao">
            <CadastroPeloCertificado />
          </div>
          <h2>Cadastrar à mão</h2>
          <div className="cartao">
            <Formulario acao={salvarEmpresa} className="grade" botao={<button type="submit">Cadastrar</button>}>
              <label>CNPJ<input name="cnpj" required /></label>
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
              <label>Série da DPS<input name="serie_dps" defaultValue="90001" pattern="\d{1,5}" /></label>
            </Formulario>
          </div>
        </>
      )}
    </>
  );
}
