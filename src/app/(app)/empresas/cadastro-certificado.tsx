"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CampoMunicipio } from "@/components/campo-municipio";
import { cadastrarPeloCertificado, lerCertificadoParaCadastro, type SugestaoCadastro } from "./actions";

/** Etapa 1: A1 + senha → dados lidos. Etapa 2: o usuário confere/completa e grava (empresa + certificado). */
export function CadastroPeloCertificado() {
  const router = useRouter();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const [sug, setSug] = useState<SugestaoCadastro | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, setPendente] = useState(false);

  const base = () => { const f = new FormData(); if (arquivo) f.set("arquivo", arquivo); f.set("senha", senha); return f; };

  async function ler(e: React.FormEvent) {
    e.preventDefault();
    setErro(null); setPendente(true);
    try {
      const r = await lerCertificadoParaCadastro(base());
      if ("erro" in r) setErro(r.erro); else setSug(r.sugestao);
    } finally { setPendente(false); }
  }

  async function gravar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null); setPendente(true);
    const f = base();
    for (const [k, v] of new FormData(e.currentTarget).entries()) f.set(k, v);
    try {
      const r = await cadastrarPeloCertificado(f);
      if ("erro" in r) setErro(r.erro); else router.push(`/empresas/${r.id}`);
    } finally { setPendente(false); }
  }

  if (!sug) {
    return (
      <form onSubmit={ler} className="grade">
        <label className="largo">Certificado A1 (.pfx)<input type="file" accept=".pfx,.p12" required onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} /></label>
        <label>Senha do certificado<input type="password" required autoComplete="off" value={senha} onChange={(e) => setSenha(e.target.value)} /></label>
        {erro && <div className="msg erro largo">{erro}</div>}
        <div className="acoes largo"><button type="submit" disabled={pendente}>{pendente ? "Lendo…" : "Ler certificado"}</button></div>
      </form>
    );
  }

  return (
    <form onSubmit={gravar} className="grade">
      <p className="largo suave">
        Certificado de <strong>{sug.titular}</strong>, CNPJ {sug.cnpj}, válido até {new Date(sug.validoAte).toLocaleDateString("pt-BR")}. Confira os dados e grave.
      </p>
      {sug.avisos.map((a, i) => <div key={i} className="msg alerta largo">{a}</div>)}
      <label className="largo">Razão social<input name="razao_social" defaultValue={sug.razao_social} required /></label>
      <label>Nome fantasia<input name="nome_fantasia" defaultValue={sug.nome_fantasia ?? ""} /></label>
      <label>Regime
        <select name="regime" required defaultValue={sug.regime ?? ""}>
          <option value="" disabled>Escolha…</option>
          <option value="ME">Simples Nacional — ME</option>
          <option value="EPP">Simples Nacional — EPP</option>
          <option value="MEI">MEI</option>
        </select>
      </label>
      <label>Município<CampoMunicipio name="cod_municipio" codigo={sug.cod_municipio} required /></label>
      <label>Inscrição municipal<input name="inscricao_municipal" /></label>
      <label>E-mail<input name="email" type="email" defaultValue={sug.email ?? ""} /></label>
      <label>Telefone<input name="telefone" defaultValue={sug.telefone ?? ""} /></label>
      <label>Série da DPS<input name="serie_dps" defaultValue="900" pattern="\d{1,5}" /></label>
      {erro && <div className="msg erro largo">{erro}</div>}
      <div className="acoes largo">
        <button type="submit" disabled={pendente}>{pendente ? "Gravando…" : "Gravar empresa e certificado"}</button>
        <button type="button" onClick={() => { setSug(null); setErro(null); }}>Outro certificado</button>
      </div>
    </form>
  );
}
