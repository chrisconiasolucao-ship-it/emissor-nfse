"use server";

import { perfilAtual } from "@/lib/auth/sessao";
import { consultarCnpj, preenchimentoDoCnpj, type PreenchimentoCnpj } from "@/lib/empresa/consulta-cnpj";
import { cnpjValido } from "@/lib/importacao/planilha";

/**
 * Busca os dados públicos do CNPJ (BrasilAPI e, se ela falhar, as outras bases abertas da Receita) para
 * preencher um cadastro. Nada é gravado: o usuário confere e edita antes de salvar. Sem chave nem configuração.
 */
export async function buscarDadosCnpj(cnpj: string): Promise<{ erro: string } | { dados: PreenchimentoCnpj }> {
  await perfilAtual();
  const c = String(cnpj ?? "").replace(/\D/g, "");
  if (!cnpjValido(c)) return { erro: "CNPJ inválido." };
  try {
    return { dados: preenchimentoDoCnpj(await consultarCnpj(c, fetch, 6_000)) };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "A consulta do CNPJ não respondeu. Preencha à mão." };
  }
}
