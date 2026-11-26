import { Formulario } from "@/components/formulario";
import { eEscritorio } from "@/lib/auth/permissoes";
import { perfilAtual } from "@/lib/auth/sessao";
import { competenciaAtual } from "@/lib/importacao/repetir-mes";
import { supabaseServidor } from "@/lib/supabase/server";
import { buscarNoAdn, importarPlanilha, importarXmlModelo, repetirMesAnterior } from "../notas/actions";
import Link from "next/link";

function EscolhaEmpresa({ empresas, padrao }: { empresas: { id: string; razao_social: string }[]; padrao?: string | null }) {
  return (
    <label>Empresa
      <select name="empresa_id" defaultValue={padrao ?? ""} required>
        <option value="" disabled>Escolha</option>
        {empresas.map((e) => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
      </select>
    </label>
  );
}

export default async function Importar() {
  const perfil = await perfilAtual();
  const db = await supabaseServidor();
  const { data: empresas } = await db.from("empresa").select("id, razao_social").eq("ativa", true).order("razao_social");
  const { data: modelos } = await db.from("documento").select("id, empresa_id, nome_original, criado_em").eq("tipo", "xml_origem").order("criado_em", { ascending: false }).limit(30);
  const padrao = eEscritorio(perfil) ? null : perfil.empresaId;
  const lista = empresas ?? [];
  return (
    <>
      <h1>Importar</h1>
      <h2>Planilha (até 30 notas)</h2>
      <div className="cartao">
        <p className="suave">Use o <a href="/api/modelo-planilha">modelo padrão</a>. Cada linha vira uma nota na fila. O mesmo arquivo não é importado duas vezes.</p>
        <Formulario acao={importarPlanilha} className="grade" botao={<button type="submit">Importar planilha</button>}>
          <EscolhaEmpresa empresas={lista} padrao={padrao} />
          <label>Arquivo (.xlsx ou .csv)<input name="arquivo" type="file" accept=".xlsx,.csv" required /></label>
        </Formulario>
      </div>

      <h2>Repetir o mês anterior</h2>
      <div className="cartao">
        <p className="suave">Cria rascunhos com a competência escolhida a partir das notas autorizadas do mês anterior. Confira e emita na lista de notas.</p>
        <Formulario acao={repetirMesAnterior} className="grade" botao={<button type="submit">Criar rascunhos</button>}>
          <EscolhaEmpresa empresas={lista} padrao={padrao} />
          <label>Competência nova<input name="competencia" type="month" defaultValue={competenciaAtual().slice(0, 7)} required /></label>
        </Formulario>
      </div>

      <h2>Notas anteriores como modelo</h2>
      <div className="cartao">
        <Formulario acao={buscarNoAdn} className="grade" botao={<button type="submit">Buscar no ADN da Receita</button>}>
          <EscolhaEmpresa empresas={lista} padrao={padrao} />
        </Formulario>
        <Formulario acao={importarXmlModelo} className="grade" botao={<button type="submit">Enviar XML</button>}>
          <EscolhaEmpresa empresas={lista} padrao={padrao} />
          <label>XML de NFS-e<input name="arquivo" type="file" accept=".xml" required /></label>
        </Formulario>
        {(modelos ?? []).length > 0 && (
          <ul>
            {(modelos ?? []).map((m) => (
              <li key={m.id}>
                <Link href={`/notas/nova?empresa=${m.empresa_id}&documento=${m.id}`}>{m.nome_original ?? m.id}</Link>{" "}
                <span className="suave">{new Date(m.criado_em).toLocaleDateString("pt-BR")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
