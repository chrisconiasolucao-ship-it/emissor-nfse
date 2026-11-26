import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aprenderDaNfse } from "@/lib/cadastros/aprender";
import { lerNfse } from "@/lib/nfse/nfse-parser";

type Linha = Record<string, unknown>;

/** Supabase de mentira com o mínimo usado por aprenderDaNfse (upsert ignorando duplicado, select por igualdade, insert). */
function bancoFalso() {
  const tabelas: { tomador: Linha[]; servico: Linha[] } = { tomador: [], servico: [] };
  const db = {
    from(t: string) {
      const linhas = tabelas[t as keyof typeof tabelas];
      const filtros: [string, unknown][] = [];
      const consulta = {
        eq(c: string, v: unknown) { filtros.push([c, v]); return consulta; },
        then(ok: (r: { data: Linha[] }) => unknown) { return Promise.resolve({ data: linhas.filter((l) => filtros.every(([c, v]) => l[c] === v)) }).then(ok); },
      };
      return {
        select: () => consulta,
        insert: async (l: Linha) => { linhas.push(l); return { error: null }; },
        upsert: (l: Linha) => ({
          select: async () => {
            const existe = linhas.some((x) => x.empresa_id === l.empresa_id && x.tipo_documento === l.tipo_documento && x.documento === l.documento);
            if (existe) return { data: [], error: null };
            linhas.push(l);
            return { data: [l], error: null };
          },
        }),
      };
    },
  };
  return { db: db as unknown as SupabaseClient, tabelas };
}

const modelo = lerNfse(readFileSync("tests/fixtures/nfse-170.xml", "utf8"));

describe("cadastros a partir da NFS-e importada", () => {
  it("empresa prestadora: cria tomador e serviço uma vez só, mesmo importando de novo", async () => {
    const { db, tabelas } = bancoFalso();
    const empresa = { id: "e1", cnpj: modelo.prestadorCnpj! };
    expect(await aprenderDaNfse(db, empresa, modelo, "xml")).toEqual({ tomador: modelo.tomador ? "novo" : "sem", servico: "novo" });
    expect(await aprenderDaNfse(db, empresa, modelo, "adn")).toEqual({ tomador: modelo.tomador ? "existente" : "sem", servico: "existente" });
    expect(tabelas.servico).toHaveLength(1);
    expect(tabelas.servico[0]).toMatchObject({ empresa_id: "e1", codigo_tributacao_nacional: modelo.servico.codigoTributacaoNacional, origem: "xml" });
    if (modelo.tomador) expect(tabelas.tomador).toHaveLength(1);
  });

  it("nota recebida (empresa é a tomadora): não vira cadastro", async () => {
    const { db, tabelas } = bancoFalso();
    expect(await aprenderDaNfse(db, { id: "e1", cnpj: "99888777000166" }, modelo, "adn")).toEqual({ tomador: "sem", servico: "sem" });
    expect(tabelas.tomador).toHaveLength(0);
    expect(tabelas.servico).toHaveLength(0);
  });
});
