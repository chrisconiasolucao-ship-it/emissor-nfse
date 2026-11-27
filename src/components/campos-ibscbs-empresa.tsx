import { catalogo } from "@/lib/catalogo";

/** Campos do IBS/CBS no cadastro da empresa (NT 009): regime no Simples (regApIBSCBSSN) e atividade do Simples padrão (cAtvSN). */
export function CamposIbsCbsEmpresa({ regime, cativSn }: { regime?: number | null; cativSn?: string | null }) {
  return (
    <>
      <label>
        IBS/CBS no Simples (2027)
        <select name="regime_ibscbs_sn" defaultValue={String(regime ?? 1)}>
          <option value="1">IBS e CBS pelo Simples (padrão)</option>
          <option value="2">CBS pelo Simples, IBS pelo regime regular (passou do sublimite)</option>
          <option value="3">IBS e CBS pelo regime regular</option>
        </select>
        <span className="suave">ME/EPP. Só vai na nota quando a Receita liberar os campos novos.</span>
      </label>
      <label>
        Atividade do Simples (cAtvSN)
        <select name="cativ_sn" defaultValue={cativSn?.trim() ?? ""}>
          <option value="">Escolher depois</option>
          {catalogo.rtcAtividadeSn.map(([codigo, anexo, descricao]) => (
            <option key={codigo} value={codigo}>
              {codigo} · Anexo {anexo} · {descricao.length > 90 ? `${descricao.slice(0, 90)}…` : descricao}
            </option>
          ))}
        </select>
        <span className="suave">Padrão da empresa; o serviço pode ter o seu. Contábil com ISS fixo é 08; Fator R é 09.</span>
      </label>
    </>
  );
}
