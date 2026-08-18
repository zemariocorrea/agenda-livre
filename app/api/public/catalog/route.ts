import { getD1 } from "@/lib/d1";
import { cleanText, jsonError } from "@/lib/http";
import { correlationIdFor, isDatabaseUnavailable, problemDetails } from "@/lib/problem-details";

type PublicProfessional = {
  id: string;
  name: string;
  title: string;
  bio: string;
  color: string;
  durationMinutes: number;
  priceCents: number;
};

type PublicTenant = {
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  timezone: string;
  currency: string;
  location: string;
  brand_color: string;
  secondary_color: string;
  hero_title: string;
  hero_description: string;
  logo_url: string;
  cover_image_url: string;
  site_template: string;
  promotion_enabled: number;
  promotion_title: string;
  promotion_description: string;
  promotion_image_url: string;
};

export async function GET(request: Request) {
  const correlationId = correlationIdFor(request);

  try {
    const slug = cleanText(new URL(request.url).searchParams.get("tenant"), 100) || "clinica-aurora";
    const d1 = await getD1();

    const tenant = await d1.prepare(`
      SELECT
        id,
        slug,
        name,
        subtitle,
        timezone,
        currency,
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
    `).bind(slug).first<PublicTenant>();

    if (!tenant) return jsonError("Empresa não encontrada.", 404, "TENANT_NOT_FOUND");

    const [servicesResult, linksResult] = await d1.batch([
      d1.prepare(`
        SELECT id, name, description, duration_minutes, price_cents, color
        FROM services
        WHERE tenant_id = ? AND is_active = 1
        ORDER BY sort_order, name
      `).bind(tenant.id),
      d1.prepare(`
        SELECT
          link.service_id,
          professional.id,
          professional.name,
          professional.title,
          professional.bio,
          professional.color,
          COALESCE(link.duration_minutes, service.duration_minutes) AS duration_minutes,
          COALESCE(link.price_cents, service.price_cents) AS price_cents
        FROM professional_services AS link
        INNER JOIN professionals AS professional
          ON professional.id = link.professional_id
         AND professional.tenant_id = link.tenant_id
        INNER JOIN services AS service
          ON service.id = link.service_id
         AND service.tenant_id = link.tenant_id
        WHERE link.tenant_id = ?
          AND link.is_active = 1
          AND professional.is_active = 1
          AND service.is_active = 1
        ORDER BY professional.sort_order, professional.name
      `).bind(tenant.id),
    ]);

    const links = linksResult.results as Array<Record<string, unknown>>;
    const services = (servicesResult.results as Array<Record<string, unknown>>)
      .map((service) => {
        const professionals = links
          .filter((link) => link.service_id === service.id)
          .map((link): PublicProfessional => ({
            id: String(link.id),
            name: String(link.name),
            title: String(link.title),
            bio: String(link.bio ?? ""),
            color: String(link.color),
            durationMinutes: Number(link.duration_minutes),
            priceCents: Number(link.price_cents),
          }));

        return {
          id: String(service.id),
          name: String(service.name),
          description: String(service.description ?? ""),
          durationMinutes: Number(service.duration_minutes),
          priceCents: Number(service.price_cents),
          color: String(service.color),
          professionals,
        };
      })
      .filter((service) => service.professionals.length > 0);

    return Response.json({
      tenant: {
        slug: tenant.slug,
        name: tenant.name,
        subtitle: tenant.subtitle,
        timezone: tenant.timezone,
        currency: tenant.currency,
        location: tenant.location,
        brandColor: tenant.brand_color,
        secondaryColor: tenant.secondary_color,
        heroTitle: tenant.hero_title,
        heroDescription: tenant.hero_description,
        logoUrl: tenant.logo_url,
        coverImageUrl: tenant.cover_image_url,
        siteTemplate: tenant.site_template,
        promotion: {
          enabled: Boolean(tenant.promotion_enabled),
          title: tenant.promotion_title,
          description: tenant.promotion_description,
          imageUrl: tenant.promotion_image_url,
        },
      },
      services,
    });
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return problemDetails({
        status: 503,
        title: "Banco de dados indisponível",
        detail: "O banco local ainda não está disponível ou as migrações não foram aplicadas.",
        code: "DATABASE_UNAVAILABLE",
        instance: new URL(request.url).pathname,
        correlationId,
      });
    }
    throw error;
  }
}