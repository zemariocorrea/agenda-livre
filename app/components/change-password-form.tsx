"use client";

import { FormEvent, useState } from "react";

export function ChangePasswordForm({ returnTo }: { returnTo: string }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: data.get("currentPassword"),
          newPassword: data.get("newPassword"),
          confirmPassword: data.get("confirmPassword"),
          returnTo,
        }),
      });
      const body = await response.json() as { error?: string | { message?: string }; redirectTo?: string };
      if (!response.ok || !body.redirectTo) {
        setError(typeof body.error === "string" ? body.error : body.error?.message ?? "Não foi possível alterar a senha.");
        return;
      }
      window.location.assign(body.redirectTo);
    } catch {
      setError("Não foi possível conectar ao servidor.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="auth-shell"><section className="auth-card">
    <div className="auth-brand"><span>AL</span><div><strong>Agenda Livre</strong><small>Segurança da conta</small></div></div>
    <div className="auth-heading"><p className="eyebrow">Senha</p><h1>Defina sua nova senha</h1><p>Use pelo menos 12 caracteres. Evite reutilizar senhas de outros serviços.</p></div>
    <form className="auth-form" onSubmit={submit}>
      <label>Senha atual<input autoComplete="current-password" name="currentPassword" type="password" required /></label>
      <label>Nova senha<input autoComplete="new-password" minLength={12} maxLength={128} name="newPassword" type="password" required /></label>
      <label>Confirmar nova senha<input autoComplete="new-password" minLength={12} maxLength={128} name="confirmPassword" type="password" required /></label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="auth-primary" disabled={loading} type="submit">{loading ? "Salvando..." : "Alterar senha"}</button>
    </form>
  </section></main>;
}
