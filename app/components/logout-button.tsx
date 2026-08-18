"use client";

export function LogoutButton({ className = "auth-logout" }: { className?: string }) {
  async function logout() {
    try { await fetch("/api/auth/logout", { method: "POST" }); } finally { window.location.assign("/login"); }
  }
  return <button className={className} onClick={logout} type="button">Sair</button>;
}
