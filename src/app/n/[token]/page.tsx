import type { Metadata } from "next";
import { headers } from "next/headers";
import { ipDe } from "@/lib/auditoria/audit";
import { arquivosDaNota, dadosDaNota, lerNotaParaEnvio, registrarAcesso, segredoDoLink } from "@/lib/envio/arquivos";
import { eRobo, lerToken } from "@/lib/envio/link";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "NFS-e", robots: { index: false, follow: false } };

/** Página pública do link enviado por WhatsApp: o tomador baixa o DANFSe e o XML sem login, até o link vencer. */
export default async function NotaPublica({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const lido = lerToken(token, await segredoDoLink());
  const nota = "notaId" in lido ? await lerNotaParaEnvio(supabaseAdmin(), lido.notaId) : null;
  const arquivos = nota ? await arquivosDaNota(supabaseAdmin(), nota) : [];
  const d = nota ? dadosDaNota(nota) : null;
  const h = await headers();
  const navegador = h.get("user-agent");
  // a prévia que o WhatsApp monta sozinho não conta como abertura do tomador
  if (nota && "notaId" in lido && !eRobo(navegador)) {
    await registrarAcesso(supabaseAdmin(), { empresaId: nota.empresa_id, notaId: nota.id, envioId: lido.envioId, tipo: "abriu_link", ip: ipDe(h), navegador });
  }
  return (
    <main style={{ maxWidth: 520, margin: "48px auto", padding: "0 16px" }}>
      <section className="cartao">
        {!nota || !d ? (
          <>
            <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>{"erro" in lido && lido.erro === "expirado" ? "Este link venceu" : "Link inválido"}</h1>
            <p className="suave" style={{ margin: 0 }}>Peça um novo link a quem enviou a nota.</p>
          </>
        ) : (
          <>
            <span className="suave">{d.empresa}</span>
            <h1 style={{ fontSize: 22, margin: "4px 0" }}>NFS-e{d.numero ? ` nº ${d.numero}` : ""}</h1>
            <div className="valor">{d.valor}</div>
            {d.tomador && <p style={{ margin: "8px 0 0" }}>Tomador: {d.tomador}</p>}
            {d.competencia && <p className="suave" style={{ margin: "2px 0 0" }}>Competência {d.competencia}</p>}
            {nota.situacao !== "autorizada" && <div className="msg alerta" style={{ marginTop: 12 }}>Atenção: esta nota está {nota.situacao === "cancelada" ? "cancelada" : nota.situacao === "substituida" ? "substituída por outra" : nota.situacao}.</div>}
            <div className="acoes" style={{ marginTop: 16 }}>
              {arquivos.map((a) => (
                <a key={a.id} className={`botao${a.tipo === "danfse" ? "" : " secundario"}`} href={`/n/${token}/arquivo?tipo=${a.tipo}`}>
                  {a.tipo === "danfse" ? "Baixar PDF (DANFSe)" : "Baixar XML"}
                </a>
              ))}
            </div>
            {"validoAte" in lido && <p className="suave" style={{ margin: "12px 0 0", fontSize: 13 }}>Link válido até {lido.validoAte.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.</p>}
          </>
        )}
      </section>
    </main>
  );
}
