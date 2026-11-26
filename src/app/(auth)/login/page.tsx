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
    <main style={{ maxWidth: 380, paddingTop: 80 }}>
      <h1>Emissor NFS-e</h1>
      <form action={entrar} className="cartao" style={{ display: "grid", gap: 12 }}>
        <label>E-mail<input name="email" type="email" autoComplete="username" required /></label>
        <label>Senha<input name="senha" type="password" autoComplete="current-password" required /></label>
        {erro && <div className="msg erro">{erro}</div>}
        <button type="submit" disabled={pendente}>{pendente ? "Entrando…" : "Entrar"}</button>
      </form>
      <p className="suave">Depois de 3 senhas erradas o acesso fica bloqueado por 15 minutos.</p>
    </main>
  );
}
