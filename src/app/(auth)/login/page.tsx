"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Login() {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, setPendente] = useState(false);

  async function entrar(form: FormData) {
    setPendente(true);
    setErro(null);
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), senha: form.get("senha") }),
    });
    setPendente(false);
    if (r.ok) return router.replace("/painel");
    const j = (await r.json().catch(() => ({}))) as { erro?: string };
    setErro(j.erro ?? "Não foi possível entrar.");
  }

  return (
    <main className="entrada">
      <form action={entrar} className="cartao">
        <div className="marca">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-chriscon.svg" alt="" width={44} height={44} />
          <span><strong>CHRISCON · NFS-e</strong><small>emissor de notas</small></span>
        </div>
        <label>E-mail<input name="email" type="email" autoComplete="username" required /></label>
        <label>Senha<input name="senha" type="password" autoComplete="current-password" required /></label>
        {erro && <div className="msg erro">{erro}</div>}
        <button type="submit" disabled={pendente}>{pendente ? "Entrando…" : "Entrar"}</button>
        <p className="suave" style={{ margin: 0 }}>Depois de 3 senhas erradas o acesso fica bloqueado por 15 minutos.</p>
      </form>
    </main>
  );
}
