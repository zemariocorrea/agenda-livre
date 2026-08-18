import Link from "next/link";
import { LogoutButton } from "../components/logout-button";

export default function AccessDeniedPage() {
  return <main className="auth-shell"><section className="auth-card">
    <div className="auth-heading"><p className="eyebrow">Acesso</p><h1>Acesso não autorizado</h1><p>Sua conta está autenticada, mas não possui permissão para esta área.</p></div>
    <div className="auth-actions"><Link className="auth-primary" href="/">Voltar ao início</Link><LogoutButton className="auth-secondary" /></div>
  </section></main>;
}
