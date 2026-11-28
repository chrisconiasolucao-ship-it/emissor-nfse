"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const INTERVALO_MS = 4000;
const LIMITE_MS = 5 * 60 * 1000;

/**
 * Enquanto a nota está na fila ou enviando, mostra o "carregando" e atualiza a tela sozinha a cada 4 s, até a
 * Receita responder (autorizada ou rejeitada) ou passar de 5 minutos. A emissão começa logo após o clique; o pg_cron (a cada minuto) é a rede de segurança.
 */
export function AcompanharNota({ texto }: { texto: string }) {
  const router = useRouter();
  const [inicio, setInicio] = useState(() => Date.now());
  const [passou, setPassou] = useState(0);
  const esgotou = passou >= LIMITE_MS;

  useEffect(() => {
    if (esgotou) return;
    const t = setInterval(() => {
      setPassou(Date.now() - inicio);
      router.refresh();
    }, INTERVALO_MS);
    return () => clearInterval(t);
  }, [esgotou, inicio, router]);

  const seg = Math.floor(passou / 1000);
  return (
    <div className="msg alerta acompanhar" role="status" aria-live="polite">
      {esgotou
        ? <span>A Receita ainda não respondeu. A nota segue na fila; volte aqui em alguns minutos ou <button type="button" className="link" onClick={() => { setInicio(Date.now()); setPassou(0); router.refresh(); }}>continuar acompanhando</button>.</span>
        : <><span className="giro" aria-hidden="true" /><span>{texto}{seg >= 8 ? ` · ${seg < 60 ? `${seg} s` : `${Math.floor(seg / 60)} min ${seg % 60} s`}` : ""}</span></>}
    </div>
  );
}
