import { BookingWizard } from "./components/booking-wizard";
import { getD1 } from "@/lib/d1";
import { cleanText } from "@/lib/http";

export const dynamic = "force-dynamic";

type PublicTenant = {
  slug: string;
  name: string;
  subtitle: string;
  location: string;
};

const fallbackTenant: PublicTenant = {
  slug: "clinica-aurora",
  name: "Clínica Aurora",
  subtitle: "Saúde & bem-estar",
  location: "Curitiba · PR",
};

export default async function Home({ searchParams }: { searchParams?: Promise<{ tenant?: string }> }) {
  const params = await searchParams;
  const slug = cleanText(params?.tenant, 100) || fallbackTenant.slug;
  const tenant = await loadTenant(slug);

  return (
    <main className="booking-shell">
      <header className="public-header">
        <a className="brand" href="#inicio" aria-label={`${tenant.name} - início`}>
          <span className="brand-mark">{tenant.name.slice(0, 1).toUpperCase()}</span>
          <span><strong>{tenant.name}</strong><small>{tenant.subtitle}</small></span>
        </a>
        <div className="header-meta">
          <span>{tenant.location}</span>
          <a href={`/admin?tenant=${encodeURIComponent(tenant.slug)}`}>Área do gestor</a>
        </div>
      </header>

      <section className="hero" id="inicio">
        <div className="hero-copy">
          <p className="eyebrow">Agendamento online</p>
          <h1>Seu cuidado começa com um horário só seu.</h1>
          <p className="hero-description">Escolha o atendimento, encontre o melhor horário e confirme em poucos passos. Sem ligações e sem espera.</p>
          <div className="trust-row" aria-label="Benefícios do agendamento">
            <span>Confirmação imediata</span>
            <span>Lembretes automáticos</span>
            <span>Pagamento opcional</span>
          </div>
        </div>

        <BookingWizard tenantSlug={tenant.slug} />
      </section>

      <footer className="public-footer">
        <span>© {new Date().getUTCFullYear()} {tenant.name}</span>
        <span className="powered-by">Agendamento por <strong>Agenda Livre</strong></span>
      </footer>
    </main>
  );
}

async function loadTenant(slug: string): Promise<PublicTenant> {
  try {
    const d1 = await getD1();
    return await d1.prepare(
      "SELECT slug, name, subtitle, location FROM tenants WHERE slug = ? AND is_active = 1 LIMIT 1",
    ).bind(slug).first<PublicTenant>() ?? fallbackTenant;
  } catch {
    return fallbackTenant;
  }
}
