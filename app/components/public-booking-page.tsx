import type { CSSProperties } from "react";
import { getD1 } from "@/lib/d1";
import { BookingWizard } from "./booking-wizard";

type TenantSite = {
  slug: string;
  name: string;
  subtitle: string;
  location: string;
  brand_color: string;
  secondary_color: string;
  hero_title: string;
  hero_description: string;
  logo_url: string;
  cover_image_url: string;
  site_template: "modern" | "classic" | "direct";
  promotion_enabled: number;
  promotion_title: string;
  promotion_description: string;
  promotion_image_url: string;
};

export async function PublicBookingPage({ tenantSlug }: { tenantSlug: string }) {
  const d1 = await getD1();
  const tenant = await d1.prepare(`
    SELECT
      slug,
      name,
      subtitle,
      location,
      brand_color,
      secondary_color,
      hero_title,
      hero_description,
      logo_url,
      cover_image_url,
      site_template,
      promotion_enabled,
      promotion_title,
      promotion_description,
      promotion_image_url
    FROM tenants
    WHERE slug = ? AND is_active = 1
    LIMIT 1
  `).bind(tenantSlug).first<TenantSite>();

  if (!tenant) {
    return <main className="booking-shell public-not-found">
      <section className="booking-card">
        <p className="eyebrow">Agenda Livre</p>
        <h1>Empresa não encontrada.</h1>
        <p className="hero-description">Confira o endereço da página ou entre em contato com a empresa.</p>
      </section>
    </main>;
  }

  const style = {
    "--tenant-brand": tenant.brand_color || "#17624f",
    "--tenant-secondary": tenant.secondary_color || "#f2ac72",
  } as CSSProperties;

  return <main className={`booking-shell public-tenant-site template-${tenant.site_template || "modern"}`} style={style}>
    <header className="public-header">
      <a className="brand" href="#inicio" aria-label={`${tenant.name} - início`}>
        <span className={`brand-mark ${tenant.logo_url ? "has-image" : ""}`}>
          {tenant.logo_url
            ? <img src={tenant.logo_url} alt={`Logo ${tenant.name}`} />
            : tenant.name.slice(0, 1).toUpperCase()}
        </span>
        <span>
          <strong>{tenant.name}</strong>
          <small>{tenant.subtitle}</small>
        </span>
      </a>

      <div className="header-meta">
        <span>{tenant.location}</span>
        <a href={`/admin?tenant=${encodeURIComponent(tenant.slug)}`}>Área do gestor</a>
      </div>
    </header>

    <section className="hero" id="inicio">
      <div className="hero-copy">
        {tenant.cover_image_url && <figure className="public-cover">
          <img src={tenant.cover_image_url} alt={`Apresentação de ${tenant.name}`} />
        </figure>}

        <p className="eyebrow">Agendamento online</p>
        <h1>{tenant.hero_title || "Agende seu horário."}</h1>
        <p className="hero-description">
          {tenant.hero_description || "Escolha o atendimento, o profissional e o melhor horário para você."}
        </p>

        <div className="trust-row" aria-label="Benefícios do agendamento">
          <span>Confirmação imediata</span>
          <span>Lembretes automáticos</span>
          <span>Pagamento opcional</span>
        </div>
      </div>

      <BookingWizard tenantSlug={tenant.slug} />
    </section>

    {Boolean(tenant.promotion_enabled) && (tenant.promotion_title || tenant.promotion_description || tenant.promotion_image_url) && (
      <section className="public-promotion">
        {tenant.promotion_image_url && <div className="public-promotion-image">
          <img src={tenant.promotion_image_url} alt="" />
        </div>}
        <div className="public-promotion-copy">
          <p className="eyebrow">Destaque</p>
          <h2>{tenant.promotion_title || "Confira nossa promoção"}</h2>
          {tenant.promotion_description && <p>{tenant.promotion_description}</p>}
          <a href="#inicio">Agendar agora</a>
        </div>
      </section>
    )}

    <footer className="public-footer">
      <span>© {new Date().getUTCFullYear()} {tenant.name}</span>
      <span className="powered-by">Agendamento por <strong>Agenda Livre</strong></span>
    </footer>
  </main>;
}