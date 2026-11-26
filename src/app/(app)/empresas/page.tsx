import Link from "next/link";
import { Formulario } from "@/components/formulario";
import { eEscritorio } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { supabaseServidor } from "@/lib/supabase/server";
import { salvarEmpresa } from "./actions";
import { CadastroPeloCertificado } from "./cadastro-certificado";
import { CampoMunicipio } from "@/components/campo-municipio";
import { documento } from "@/lib/formato";

export default async function Empresas() {
  const perfil = await perfilAtual();
  const db = await supabaseServidor();
  const { data } = await db.from("empresa").select("id, razao_social, cnpj, regime, pausada, ativa").order("razao_social");
  return (
    <>
      <h1>Empresas</h1>
      <div className="empresas">
        {(data ?? []).map((e) => (
          <Link key={e.id} href={`/empresas/${e.id}`} className="cartao empresa" style={{ color: "inherit", textDecoration: "none" }}>
            <div className="empresa-topo">
              <span className="sigla" aria-hidden="true">{String(e.razao_social).split(/\s+/).filter((p: string) => p.length > 2).slice(0, 2).map((p: string) => p[0]!.toUpperCase()).join("")}</span>
              <div><strong>{e.razao_social}</strong><span className="suave">{documento(e.cnpj)} · {e.regime}</span></div>
            </div>
            <div className="empresa-pe">
              <span className={`selo ${!e.ativa ? "cancelada" : e.pausada ? "na_fila" : "autorizada"}`}>{!e.ativa ? "Inativa" : e.pausada ? "Pausada" : "Ativa"}</span>
              <span className="suave">Ver cadastro, certificado e usuários</span>
            </div>
          </Link>
        ))}
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
              <label>Série da DPS<input name="serie_dps" defaultValue="900" pattern="\d{1,5}" /></label>
              <label>Alíquota do Simples (%)<input name="aliquota_simples" inputMode="decimal" placeholder="ex.: 6,00" defaultValue="" /><span className="suave">ME/EPP: vai na nota como percentual aproximado de tributos.</span></label>
            </Formulario>
          </div>
        </>
      )}
    </>
  );
}
