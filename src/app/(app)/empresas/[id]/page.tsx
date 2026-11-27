import Link from "next/link";
import { notFound } from "next/navigation";
import { CampoMunicipio } from "@/components/campo-municipio";
import { Formulario } from "@/components/formulario";
import { eEscritorio, podeCriarUsuario } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { diasParaVencer } from "@/lib/crypto/pfx";
import { supabaseServidor } from "@/lib/supabase/server";
import { documento } from "@/lib/formato";
import { alterarAtivaEmpresa, criarUsuario, enviarCertificado, excluirEmpresa, retomarEmpresa, salvarEmpresa } from "../actions";

export default async function Empresa({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const perfil = await perfilAtual();
  const db = await supabaseServidor();
  const { data: e } = await db.from("empresa").select("*").eq("id", id).maybeSingle();
  if (!e) notFound();
  const escritorio = eEscritorio(perfil);
  // AT-011: só metadados do certificado (a coluna do arquivo e da senha não é legível pela tela)
  const { data: cert } = await db.from("certificado").select("titular, cnpj_titular, valido_ate, enviado_em").eq("empresa_id", id).eq("ativo", true).maybeSingle();
  const { data: usuarios } = await db.from("perfil_usuario").select("usuario_id, nome, email, papel, ativo").eq("empresa_id", id).order("nome");
  const dias = cert ? diasParaVencer(new Date(cert.valido_ate)) : null;
  const { count: notas } = escritorio ? await db.from("nota").select("id", { count: "exact", head: true }).eq("empresa_id", id) : { count: 0 };
  return (
    <>
      <div className="cab">
        <div>
          <h1>{e.razao_social}</h1>
          <p>CNPJ {documento(e.cnpj)} · {e.regime}{e.ativa ? "" : " · desativada"}</p>
        </div>
        {e.ativa && <div className="acoes">{escritorio ? <a className="botao" href={`/api/empresa-atual?id=${id}&para=/painel`}>Abrir painel da empresa</a> : <Link className="botao" href="/painel">Painel</Link>}</div>}
      </div>
      {!e.ativa && <div className="msg alerta">Esta empresa está desativada: não aparece nas listas nem no menu, e a busca no ADN não roda para ela.</div>}
      {e.pausada && (
        <div className="msg alerta">
          Emissão pausada: {e.motivo_pausa}
          {escritorio && (
            <form action={retomarEmpresa} style={{ marginTop: 8 }}>
              <input type="hidden" name="empresa_id" value={id} />
              <button type="submit">Retomar emissão</button>
            </form>
          )}
        </div>
      )}
      <h2>Cadastro</h2>
      <div className="cartao">
        {escritorio ? (
          <Formulario acao={salvarEmpresa} className="grade" botao={<button type="submit">Salvar</button>}>
            <input type="hidden" name="id" value={id} />
            <label>CNPJ<input name="cnpj" defaultValue={e.cnpj} required /></label>
            <label className="largo">Razão social<input name="razao_social" defaultValue={e.razao_social} required /></label>
            <label>Nome fantasia<input name="nome_fantasia" defaultValue={e.nome_fantasia ?? ""} /></label>
            <label>Regime
              <select name="regime" defaultValue={e.regime}>
                <option value="ME">Simples Nacional — ME</option><option value="EPP">Simples Nacional — EPP</option><option value="MEI">MEI</option>
              </select>
            </label>
            <label>Município<CampoMunicipio name="cod_municipio" codigo={e.cod_municipio} required /></label>
            <label>Inscrição municipal<input name="inscricao_municipal" defaultValue={e.inscricao_municipal ?? ""} /></label>
            <label>E-mail<input name="email" defaultValue={e.email ?? ""} /></label>
            <label>Telefone<input name="telefone" defaultValue={e.telefone ?? ""} /></label>
            <label>Série da DPS<input name="serie_dps" defaultValue={e.serie_dps} /></label>
            <label>Alíquota do Simples (%)<input name="aliquota_simples" inputMode="decimal" placeholder="ex.: 6,00" defaultValue={e.aliquota_simples ?? ""} /><span className="suave">ME/EPP: vai na nota como percentual aproximado de tributos.</span></label>
            <label>Regime do ISS<select name="regime_iss" defaultValue={e.regime_iss ?? "normal"}><option value="normal">Normal (ISS pela alíquota, no DAS ou retido)</option><option value="sociedade_profissionais">ISS fixo · sociedade de profissionais</option></select><span className="suave">ISS fixo: a nota sai sem alíquota e sem ISS retido.</span></label>
          </Formulario>
        ) : (
          <p>{e.cnpj} · {e.regime} · município {e.cod_municipio}</p>
        )}
      </div>

      <h2>Certificado A1</h2>
      <div className="cartao">
        {cert ? (
          <p className={dias !== null && dias <= 30 ? "msg alerta" : ""}>
            {cert.titular} {cert.cnpj_titular ? `(${cert.cnpj_titular})` : ""} · válido até {new Date(cert.valido_ate).toLocaleDateString("pt-BR")} ({dias} dias)
          </p>
        ) : (
          <p className="msg alerta">Sem certificado: a emissão desta empresa fica parada.</p>
        )}
        {escritorio && (
          <Formulario acao={enviarCertificado} className="grade" botao={<button type="submit">Enviar certificado</button>}>
            <input type="hidden" name="empresa_id" value={id} />
            <label>Arquivo .pfx<input name="arquivo" type="file" accept=".pfx,.p12" required /></label>
            <label>Senha<input name="senha" type="password" autoComplete="off" required /></label>
          </Formulario>
        )}
      </div>

      <h2>Usuários da empresa</h2>
      <div className="tabela">
        <table>
          <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th></tr></thead>
          <tbody>{(usuarios ?? []).map((u) => <tr key={u.usuario_id}><td>{u.nome}</td><td>{u.email}</td><td>{u.papel.replace("_", " ")}{u.ativo ? "" : " (inativo)"}</td></tr>)}</tbody>
        </table>
      </div>
      {podeCriarUsuario(perfil, id, "cliente_usuario") && (
        <div className="cartao" style={{ marginTop: 12 }}>
          <Formulario acao={criarUsuario} className="grade" botao={<button type="submit">Criar usuário</button>}>
            <input type="hidden" name="empresa_id" value={id} />
            <label>Nome<input name="nome" required /></label>
            <label>E-mail<input name="email" type="email" required /></label>
            <label>Perfil
              <select name="papel" defaultValue="cliente_usuario">
                <option value="cliente_usuario">Usuário (emite)</option>
                <option value="cliente_admin">Administrador (emite, cancela, cria usuários)</option>
              </select>
            </label>
          </Formulario>
        </div>
      )}

      {escritorio && (
        <>
          <h2>Desativar ou excluir</h2>
          <div className="cartao zona-perigo">
            <div>
              <strong>{e.ativa ? "Desativar empresa" : "Reativar empresa"}</strong>
              <p className="suave">{e.ativa
                ? "Ela sai da lista de empresas, do menu e da busca automática no ADN. Notas, tomadores, serviços e certificado ficam guardados, e dá para reativar depois."
                : "Ela volta para a lista de empresas e para a busca automática no ADN."}</p>
              <Formulario acao={alterarAtivaEmpresa} botao={<button type="submit" className="secundario">{e.ativa ? "Desativar empresa" : "Reativar empresa"}</button>}>
                <input type="hidden" name="empresa_id" value={id} />
                <input type="hidden" name="ativa" value={e.ativa ? "false" : "true"} />
              </Formulario>
            </div>
            <div>
              <strong>Excluir de vez</strong>
              {(notas ?? 0) > 0 ? (
                <p className="suave">Esta empresa tem {notas} {notas === 1 ? "nota" : "notas"}. Nota fiscal fica guardada por lei, então a empresa não pode ser excluída; use Desativar.</p>
              ) : (
                <>
                  <p className="suave">Só para empresa cadastrada por engano, sem notas, importações nem usuários. Apaga o cadastro, o certificado, os tomadores e os serviços. Não tem como desfazer.</p>
                  <Formulario acao={excluirEmpresa} className="grade" botao={<button type="submit" className="perigo">Excluir empresa</button>}>
                    <input type="hidden" name="empresa_id" value={id} />
                    <label>Digite o CNPJ para confirmar<input name="confirmacao" required autoComplete="off" placeholder={documento(e.cnpj)} /></label>
                  </Formulario>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
