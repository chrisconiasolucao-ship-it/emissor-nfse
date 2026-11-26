"use server";

import { supabaseServidor } from "@/lib/supabase/server";

export type OpcaoMunicipio = { cod: string; nome: string; uf: string };

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Busca para o campo de município: por código IBGE (7 dígitos) ou por nome, com "/UF" opcional. Lê municipio_situacao. */
export async function buscarMunicipios(termo: string): Promise<OpcaoMunicipio[]> {
  const t = semAcento(String(termo ?? "")).trim();
  if (t.length < 2) return [];
  const db = await supabaseServidor();
  let q = db.from("municipio_situacao").select("cod_ibge, nome, uf").order("nome").limit(15);
  if (/^\d{7}$/.test(t)) q = q.eq("cod_ibge", t);
  else {
    const [nome, uf] = t.split("/").map((x) => x.trim());
    q = q.ilike("nome", `${nome!.replace(/[%_]/g, "")}%`);
    if (uf && /^[A-Za-z]{2}$/.test(uf)) q = q.eq("uf", uf.toUpperCase());
  }
  const { data } = await q;
  return (data ?? []).map((m) => ({ cod: m.cod_ibge, nome: m.nome, uf: m.uf }));
}
