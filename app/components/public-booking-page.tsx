import type { CSSProperties } from "react";
import { getD1 } from "@/lib/d1";
import { cleanText } from "@/lib/http";
import { BookingWizard } from "./booking-wizard";

type PublicTenant = {
  slug: string; name: string; subtitle: string; location: string;
  brandColor: string; heroTitle: string; heroDescription: string;
};

const fallbackTenant: PublicTenant = {
  slug: "clinica-aurora", name: "Clínica Aurora", subtitle: "Saúde & bem-estar", location: "Curitiba · PR",
  brandColor: "#17624f", heroTitle: "Seu cuidado começa com um horário só seu.",
  heroDescription: "Escolha o atendimento, encontre o melhor horário e confirme em poucos passos. Sem ligações e sem espera.",
};

export async function PublicBookingPage({ tenantSlug }: { tenantSlug: string }) {
  const tenant = await loadTenant(cleanText(tenantSlug, 100) || fallbackTenant.slug);
  return <main className="booking-shell" style={{ "--tenant-brand": tenant.brandColor } as CSSProperties}>
    <header className="public-header"><a className="brand" href="#inicio" aria-label={`${tenant.name} - início`}><span className="brand-mark">{tenant.name.slice(0, 1).toUpperCase()}</span><span><strong>{tenant.name}</strong><small>{tenant.subtitle}</small></span></a><div className="header-meta"><span>{tenant.location}</span><a href={`/admin?tenant=${encodeURIComponent(tenant.slug)}`}>Área do gestor</a></div></header>
    <section className="hero" id="inicio"><div className="hero-copy"><p className="eyebrow">Agendamento online</p><h1>{tenant.heroTitle}</h1><p className="hero-description">{tenant.heroDescription}</p><div className="trust-row" aria-label="Benefícios do agendamento"><span>Confirmação imediata</span><span>Lembretes automáticos</span><span>Pagamento opcional</span></div></div><BookingWizard tenantSlug={tenant.slug} /></section>
    <footer className="public-footer"><span>© {new Date().getUTCFullYear()} {tenant.name}</span><span className="powered-by">Agendamento por <strong>Agenda Livre</strong></span></footer>
  </main>;
}

async function loadTenant(slug: string): Promise<PublicTenant> {
  try {
    const d1 = await getD1();
    const row = await d1.prepare("SELECT slug, name, subtitle, location, brand_color, hero_title, hero_description FROM tenants WHERE slug = ? AND is_active = 1 LIMIT 1")
      .bind(slug).first<{ slug: string; name: string; subtitle: string; location: string; brand_color: string; hero_title: string; hero_description: string }>();
    return row ? { slug: row.slug, name: row.name, subtitle: row.subtitle, location: row.location, brandColor: row.brand_color, heroTitle: row.hero_title, heroDescription: row.hero_description } : fallbackTenant;
  } catch { return fallbackTenant; }
}
