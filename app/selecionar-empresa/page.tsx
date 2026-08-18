import Link from "next/link";
import { requireTenantSelectionPage } from "@/lib/auth/access";
import { LogoutButton } from "../components/logout-button";

export const dynamic = "force-dynamic";

const roleLabel: Record<string, string> = { owner: "Proprietário", admin: "Administrador", staff: "Equipe" };

export default async function SelectTenantPage() {
  const { user, tenants } = await requireTenantSelectionPage();
  return (
    <main className="tenant-selector-shell">
      <section className="tenant-selector-card">
        <header>
          <div><p className="eyebrow">Agenda Livre</p><h1>Escolha uma empresa</h1></div>
          <div className="tenant-selector-user"><strong>{user.displayName}</strong><small>{user.email}</small><LogoutButton /></div>
        </header>
        <p className="tenant-selector-intro">Sua conta possui acesso a mais de uma empresa. Selecione o ambiente que deseja administrar.</p>
        <div className="tenant-selector-grid">
          {tenants.map((tenant) => (
            <Link key={tenant.id} href={`/admin?tenant=${encodeURIComponent(tenant.slug)}`} className="tenant-selector-item">
              <span style={{ background: tenant.brandColor }}>{tenant.name.slice(0, 1).toUpperCase()}</span>
              <div><strong>{tenant.name}</strong><small>{tenant.subtitle || tenant.location || tenant.slug}</small></div>
              <b>{roleLabel[tenant.role] ?? tenant.role}</b>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
