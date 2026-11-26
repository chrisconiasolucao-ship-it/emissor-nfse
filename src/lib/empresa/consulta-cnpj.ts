/**
 * Cadastro pela empresa a partir do certificado: o A1 traz CNPJ e razão social; o resto vem da base pública
 * do CNPJ (BrasilAPI, que espelha os dados abertos da Receita): município (IBGE) e opção pelo Simples/MEI.
 */
export type DadosCnpj = {
  razao_social?: string;
  nome_fantasia?: string | null;
  codigo_municipio_ibge?: number | string | null;
  municipio?: string | null;
  uf?: string | null;
  porte?: string | null;
  opcao_pelo_simples?: boolean | null;
  opcao_pelo_mei?: boolean | null;
  email?: string | null;
  ddd_telefone_1?: string | null;
  descricao_situacao_cadastral?: string | null;
};

export type EmpresaSugerida = {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  regime: "ME" | "EPP" | "MEI";
  cod_municipio: string;
  municipio: string;
  email: string | null;
  telefone: string | null;
};

export class EmpresaForaDoEscopo extends Error {}

export async function consultarCnpj(cnpj: string): Promise<DadosCnpj> {
  const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
  if (r.status === 404) throw new Error(`CNPJ ${cnpj} não encontrado na base pública da Receita.`);
  if (!r.ok) throw new Error(`A consulta do CNPJ não respondeu (HTTP ${r.status}). Tente de novo ou cadastre à mão.`);
  return (await r.json()) as DadosCnpj;
}

/** AT-024: 1ª versão só Simples Nacional (ME/EPP) e MEI. */
export function sugerirEmpresa(cnpj: string, titularCertificado: string, d: DadosCnpj): EmpresaSugerida {
  if (d.descricao_situacao_cadastral && d.descricao_situacao_cadastral.toUpperCase() !== "ATIVA") {
    throw new EmpresaForaDoEscopo(`CNPJ com situação cadastral ${d.descricao_situacao_cadastral}.`);
  }
  const porte = String(d.porte ?? "").toUpperCase();
  let regime: EmpresaSugerida["regime"];
  if (d.opcao_pelo_mei) regime = "MEI";
  else if (d.opcao_pelo_simples && porte.includes("MICRO")) regime = "ME";
  else if (d.opcao_pelo_simples && porte.includes("PEQUENO")) regime = "EPP";
  else if (d.opcao_pelo_simples) throw new EmpresaForaDoEscopo(`Optante do Simples, mas o porte "${d.porte ?? "não informado"}" não diz se é ME ou EPP. Cadastre à mão.`);
  else throw new EmpresaForaDoEscopo("A empresa não é optante do Simples Nacional nem MEI; a 1ª versão emite só para essas.");
  const cod = String(d.codigo_municipio_ibge ?? "").replace(/\D/g, "");
  if (!/^\d{7}$/.test(cod)) throw new Error("A consulta não trouxe o código IBGE do município. Cadastre à mão.");
  const tel = String(d.ddd_telefone_1 ?? "").replace(/\D/g, "");
  return {
    cnpj,
    razao_social: (d.razao_social || titularCertificado).trim(),
    nome_fantasia: d.nome_fantasia?.trim() || null,
    regime,
    cod_municipio: cod,
    municipio: [d.municipio, d.uf].filter(Boolean).join("/"),
    email: d.email?.trim().toLowerCase() || null,
    telefone: tel || null,
  };
}
