"use client";

import { useMemo, useState } from "react";
import { Formulario } from "@/components/formulario";
import { enviarNotaPorEmail, registrarWhatsApp } from "@/app/(app)/notas/envio-actions";
import { linkWhatsApp, telefoneWhatsApp } from "@/lib/envio/mensagens";

export type EnvioFeito = { canal: string; destinatario: string; situacao: string; erro: string | null; quando: string };

const ROTULO_ENVIO: Record<string, string> = { enviado: "enviado", falhou: "falhou", link_aberto: "WhatsApp aberto com o link" };

/**
 * Envio da nota autorizada ao tomador: e-mail com o PDF e o XML anexados (Gmail do escritório) e WhatsApp
 * pelo wa.me, com a mensagem pronta e um link temporário para baixar os arquivos.
 */
export function EnviarNota({ notaId, email, telefone, textoWhatsApp, envios }: {
  notaId: string;
  email: string | null;
  telefone: string | null;
  textoWhatsApp: string;
  envios: EnvioFeito[];
}) {
  const [fone, setFone] = useState(telefone ?? "");
  const numero = useMemo(() => telefoneWhatsApp(fone), [fone]);
  const href = linkWhatsApp(numero, textoWhatsApp);
  return (
    <section className="cartao">
      <div className="cartao-cab"><h3>Enviar ao tomador</h3><span className="suave">O e-mail leva o PDF e o XML anexados. No WhatsApp vai um link para baixar os dois, válido por 7 dias.</span></div>
      <div className="blocos">
        <div>
          <h4 style={{ margin: "0 0 8px" }}>Por e-mail</h4>
          <Formulario acao={enviarNotaPorEmail} className="grade" botao={<button type="submit">Enviar por e-mail</button>}>
            <input type="hidden" name="id" value={notaId} />
            <label className="largo">Para<input name="para" defaultValue={email ?? ""} placeholder="email@tomador.com.br" required /></label>
            <label className="largo">Mensagem (opcional)<textarea name="mensagem" rows={2} maxLength={1000} /></label>
          </Formulario>
        </div>
        <div>
          <h4 style={{ margin: "0 0 8px" }}>Por WhatsApp</h4>
          <div className="grade">
            <label className="largo">Celular com DDD<input value={fone} onChange={(e) => setFone(e.target.value)} placeholder="(53) 99999-9999" inputMode="tel" /></label>
            {fone && !numero && <p className="msg alerta largo" style={{ margin: 0 }}>Confira o número: DDD + celular, por exemplo (53) 99999-9999.</p>}
            <div className="acoes largo">
              <a className="botao" href={href} target="_blank" rel="noopener noreferrer" aria-disabled={!numero}
                onClick={(e) => { if (!numero) { e.preventDefault(); return; } void registrarWhatsApp(notaId, fone); }}>
                Abrir no WhatsApp
              </a>
            </div>
            <p className="suave largo" style={{ margin: 0, fontSize: 13 }}>Abre o WhatsApp com a mensagem pronta para este número; é só apertar enviar.</p>
          </div>
        </div>
      </div>
      {envios.length > 0 && (
        <div className="tabela sem-borda" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Quando</th><th>Canal</th><th>Para</th><th>Situação</th></tr></thead>
            <tbody>
              {envios.map((e, i) => (
                <tr key={i}>
                  <td>{e.quando}</td>
                  <td>{e.canal === "email" ? "E-mail" : "WhatsApp"}</td>
                  <td>{e.destinatario}</td>
                  <td><span className={`selo ${e.situacao === "falhou" ? "rejeitada" : "autorizada"}`}>{ROTULO_ENVIO[e.situacao] ?? e.situacao}</span>{e.erro ? <span className="suave"> {e.erro}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
