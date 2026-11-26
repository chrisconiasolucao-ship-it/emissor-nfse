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
  regime: "ME" | "EPP" | "MEI" | null; // null: a consulta não diz; o usuário escolhe
  cod_municipio: string | null;
  municipio: string;
  email: string | null;
  telefone: string | null;
  avisos: string[];
};

export class EmpresaForaDoEscopo extends Error {}

const UA = { accept: "application/json", "user-agent": "emissor-nfse/1.0 (cadastro de empresas)" };

type Fonte = { nome: string; url: (cnpj: string) => string; mapear: (j: unknown) => DadosCnpj };

/** CNPJ.ws (formato próprio) → mesmo formato da BrasilAPI. */
function deCnpjWs(j: unknown): DadosCnpj {
  const d = j as { razao_social?: string; porte?: { descricao?: string }; simples?: { simples?: string; mei?: string } | null;
    estabelecimento?: { nome_fantasia?: string; situacao_cadastral?: string; email?: string; ddd1?: string; telefone1?: string;
      cidade?: { ibge_id?: number; nome?: string }; estado?: { sigla?: string } } };
  const e = d.estabelecimento ?? {};
  return {
    razao_social: d.razao_social, nome_fantasia: e.nome_fantasia ?? null,
    codigo_municipio_ibge: e.cidade?.ibge_id ?? null, municipio: e.cidade?.nome ?? null, uf: e.estado?.sigla ?? null,
    porte: d.porte?.descricao ?? null,
    opcao_pelo_simples: d.simples ? d.simples.simples === "Sim" : false, opcao_pelo_mei: d.simples ? d.simples.mei === "Sim" : false,
    email: e.email ?? null, ddd_telefone_1: `${e.ddd1 ?? ""}${e.telefone1 ?? ""}` || null,
    descricao_situacao_cadastral: e.situacao_cadastral ?? null,
  };
}

const FONTES: Fonte[] = [
  { nome: "BrasilAPI", url: (c) => `https://brasilapi.com.br/api/cnpj/v1/${c}`, mapear: (j) => j as DadosCnpj },
  { nome: "Minha Receita", url: (c) => `https://minhareceita.org/${c}`, mapear: (j) => j as DadosCnpj },
  { nome: "CNPJ.ws", url: (c) => `https://publica.cnpj.ws/cnpj/${c}`, mapear: deCnpjWs },
];

/** Tenta as fontes públicas (todas espelham os dados abertos da Receita) até uma responder. */
export async function consultarCnpj(cnpj: string, fetcher: typeof fetch = fetch): Promise<DadosCnpj> {
  const falhas: string[] = [];
  for (const f of FONTES) {
    try {
      const r = await fetcher(f.url(cnpj), { signal: AbortSignal.timeout(12_000), headers: UA });
      if (r.status === 404) throw new Error(`CNPJ ${cnpj} não encontrado na base pública da Receita.`);
      if (!r.ok) { falhas.push(`${f.nome} HTTP ${r.status}`); continue; }
      return f.mapear(await r.json());
    } catch (e) {
      if (e instanceof Error && e.message.includes("não encontrado")) throw e;
      falhas.push(`${f.nome} ${e instanceof Error ? e.name : "erro"}`);
    }
  }
  throw new Error(`A consulta do CNPJ não respondeu (${falhas.join(", ")}). Tente de novo ou cadastre à mão.`);
}

/**
 * Sugestão para o formulário de cadastro (o usuário confere antes de gravar).
 * AT-024: recusa só o que com certeza está fora (não optante do Simples/MEI, CNPJ não ativo);
 * porte "DEMAIS" ou ausente vira aviso e o usuário escolhe ME ou EPP.
 */
export function sugerirEmpresa(cnpj: string, titularCertificado: string, d: DadosCnpj): EmpresaSugerida {
  if (d.descricao_situacao_cadastral && d.descricao_situacao_cadastral.toUpperCase() !== "ATIVA") {
    throw new EmpresaForaDoEscopo(`CNPJ com situação cadastral ${d.descricao_situacao_cadastral}.`);
  }
  if (!d.opcao_pelo_mei && d.opcao_pelo_simples === false) {
    throw new EmpresaForaDoEscopo("A consulta diz que a empresa não é optante do Simples Nacional nem MEI; a 1ª versão emite só para essas.");
  }
  const avisos: string[] = [];
  const porte = String(d.porte ?? "").toUpperCase();
  let regime: EmpresaSugerida["regime"] = null;
  if (d.opcao_pelo_mei) regime = "MEI";
  else if (porte.includes("MICRO")) regime = "ME";
  else if (porte.includes("PEQUENO")) regime = "EPP";
  else avisos.push(`A consulta informa porte "${d.porte || "não informado"}", que não diz se é ME ou EPP. Escolha o regime.`);
  if (d.opcao_pelo_simples == null && !d.opcao_pelo_mei) avisos.push("A consulta não informou a opção pelo Simples. Confira antes de emitir.");
  const cod = String(d.codigo_municipio_ibge ?? "").replace(/\D/g, "");
  if (!/^\d{7}$/.test(cod)) avisos.push("A consulta não trouxe o município. Escolha pelo nome.");
  const tel = String(d.ddd_telefone_1 ?? "").replace(/\D/g, "");
  return {
    cnpj,
    razao_social: (d.razao_social || titularCertificado).trim(),
    nome_fantasia: d.nome_fantasia?.trim() || null,
    regime,
    cod_municipio: /^\d{7}$/.test(cod) ? cod : null,
    municipio: [d.municipio, d.uf].filter(Boolean).join("/"),
    email: d.email?.trim().toLowerCase() || null,
    telefone: tel || null,
    avisos,
  };
}
