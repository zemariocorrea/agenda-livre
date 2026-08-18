"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          password: data.get("password"),
          returnTo: new URLSearchParams(window.location.search).get("return_to") ?? "",
        }),
      });
      const body = await response.json() as { error?: string; redirectTo?: string };
      if (!response.ok || !body.redirectTo) {
        setError(body.error ?? "Não foi possível entrar.");
        return;
      }
      window.location.assign(body.redirectTo);
    } catch {
      setError("Não foi possível conectar ao servidor.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="auth-shell">
    <section className="auth-card">
      <Link className="auth-brand" href="/"><span>AL</span><div><strong>Agenda Livre</strong><small>Acesso administrativo</small></div></Link>
      <div className="auth-heading"><p className="eyebrow">Conta interna</p><h1>Entrar</h1><p>Use o e-mail e a senha cadastrados no Agenda Livre.</p></div>
      <form className="auth-form" onSubmit={submit}>
        <label>E-mail<input autoComplete="email" name="email" type="email" maxLength={254} required /></label>
        <label>Senha<input autoComplete="current-password" name="password" type="password" maxLength={256} required /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="auth-primary" disabled={loading} type="submit">{loading ? "Entrando..." : "Entrar"}</button>
      </form>
      <p className="auth-note">A autenticação administrativa é interna e protegida por sessão segura.</p>
    </section>
  </main>;
}
