import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Formulario } from "@/components/formulario";
import { auditar } from "@/lib/auditoria/audit";
import { eEscritorio } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { lerMunicipios } from "@/lib/importacao/municipios";
import { sha256 } from "@/lib/importacao/planilha";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServidor } from "@/lib/supabase/server";
import type { Estado } from "../notas/actions";

async function importarMunicipios(_: Estado, form: FormData): Promise<Estado> {
  "use server";
  const perfil = await perfilAtual();
  if (!eEscritorio(perfil)) return { erro: "Só o escritório importa a situação dos municípios." };
  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0 || arquivo.size > 10 * 1024 * 1024) return { erro: "Escolha o arquivo exportado do painel (até 10 MB)." };
  const buf = Buffer.from(await arquivo.arrayBuffer());
  let lidos, semCodigo: string[];
  try {
    ({ lidos, semCodigo } = await lerMunicipios(buf, arquivo.name));
  } catch (e) {
    return { erro: e instanceof Error ? e.message : String(e) };
  }
  const db = await supabaseServidor(); // RLS: só escritório grava
  const agora = new Date().toISOString();
  for (let i = 0; i < lidos.length; i += 500) {
    const { error } = await db.from("municipio_situacao").upsert(
      lidos.slice(i, i + 500).map((m) => ({ cod_ibge: m.codIbge, nome: m.nome, uf: m.uf, conveniado: m.conveniado, ativo_operacional: m.ativoOperacional, emissor_nacional: m.emissorNacional, importado_em: agora, importado_por: perfil.usuarioId })),
    );
    if (error) return { erro: error.message };
  }
  await auditar(supabaseAdmin(), { empresaId: null, acao: "importar_municipios", entidade: "municipio_situacao", entidadeId: null, depois: { arquivo: arquivo.name, sha256: sha256(buf), municipios: lidos.length, sem_codigo_ibge: semCodigo }, quem: perfil.usuarioId });
  revalidatePath("/municipios");
  const aviso = semCodigo.length === 0 ? "" :
    ` ${semCodigo.length} não encontrados na lista do IBGE e não importados: ${semCodigo.slice(0, 10).join(", ")}${semCodigo.length > 10 ? ` e mais ${semCodigo.length - 10}` : ""}.`;
  return { ok: true, mensagem: `${lidos.length} municípios atualizados.${aviso}` };
}

export default async function Municipios({ searchParams }: { searchParams: Promise<{ busca?: string }> }) {
  const perfil = await perfilAtual();
  if (!eEscritorio(perfil)) redirect("/notas");
  const { busca } = await searchParams;
  const db = await supabaseServidor();
  let q = db.from("municipio_situacao").select("*").order("nome").limit(100);
  if (busca) q = /^\d+$/.test(busca) ? q.like("cod_ibge", `${busca}%`) : q.ilike("nome", `%${busca}%`);
  const [{ data }, { data: ultima }] = await Promise.all([q, db.from("municipio_situacao").select("importado_em").order("importado_em", { ascending: false }).limit(1).maybeSingle()]);
  return (
    <>
      <h1>Situação dos municípios</h1>
      <p className="suave">Última importação: {ultima ? new Date(ultima.importado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "nunca"}. Importe o painel da Receita pelo menos 1 vez por mês.</p>
      <div className="cartao">
        <Formulario acao={importarMunicipios} className="grade" botao={<button type="submit">Importar</button>}>
          <label className="largo">Arquivo do painel (.xlsx ou .csv)<input name="arquivo" type="file" accept=".xlsx,.csv" required /></label>
        </Formulario>
      </div>
      <form method="get" className="acoes"><input name="busca" placeholder="nome ou código IBGE" defaultValue={busca} /><button type="submit">Buscar</button></form>
      <div className="tabela" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th>IBGE</th><th>Município</th><th>UF</th><th>Conveniado</th><th>Ativo operacional</th><th>Emissor Nacional</th></tr></thead>
          <tbody>{(data ?? []).map((m) => <tr key={m.cod_ibge}><td>{m.cod_ibge}</td><td>{m.nome}</td><td>{m.uf}</td><td>{m.conveniado ? "sim" : "não"}</td><td>{m.ativo_operacional ? "sim" : "não"}</td><td>{m.emissor_nacional ? "sim" : "não"}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}
