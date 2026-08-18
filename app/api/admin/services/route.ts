import { adminTenant } from "@/lib/admin-auth";
import { getD1 } from "@/lib/d1";
import { cleanText, jsonError } from "@/lib/http";
import { rejectCrossSiteMutation } from "@/lib/auth/request";

export async function GET(request: Request) {
  const d1 = await getD1();
  const slug = new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora";
  const access = await adminTenant(slug);
  if ("error" in access) return access.error;
  const [rows, links] = await d1.batch([
    d1.prepare("SELECT id, name, description, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents, color, is_active, sort_order FROM services WHERE tenant_id = ? ORDER BY sort_order, name").bind(access.tenant.id),
    d1.prepare("SELECT service_id, professional_id FROM professional_services WHERE tenant_id = ? AND is_active = 1").bind(access.tenant.id),
  ]);
  return Response.json({
    services: (rows.results as Array<Record<string, unknown>>).map((service) => ({
      ...service,
      professional_ids: (links.results as Array<Record<string, unknown>>)
        .filter((link) => link.service_id === service.id)
        .map((link) => String(link.professional_id)),
    })),
  });
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const d1 = await getD1();
  const url = new URL(request.url);
  const access = await adminTenant(url.searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const payload = await request.json() as Record<string, unknown>;
  const name = cleanText(payload.name, 120);
  const description = cleanText(payload.description, 500);
  const duration = Number(payload.durationMinutes);
  const priceCents = Number(payload.priceCents);
  if (!name || !Number.isInteger(duration) || duration < 5 || duration > 720 || !Number.isInteger(priceCents) || priceCents < 0) return jsonError("Informe nome, duração e preço válidos.");
  const id = crypto.randomUUID();
  const professionalIds = await resolveProfessionalIds(d1, access.tenant.id, payload.professionalIds);
  if ("error" in professionalIds) return professionalIds.error;
  await d1.batch([
    d1.prepare("INSERT INTO services (id, tenant_id, name, description, duration_minutes, price_cents, color, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM services WHERE tenant_id = ?), 1))")
      .bind(id, access.tenant.id, name, description, duration, priceCents, cleanText(payload.color, 20) || "#17624f", access.tenant.id),
    ...professionalIds.value.map((professionalId) => d1.prepare("INSERT INTO professional_services (id, tenant_id, professional_id, service_id) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), access.tenant.id, professionalId, id)),
    d1.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, 'service.created', 'service', ?, ?)")
      .bind(crypto.randomUUID(), access.tenant.id, access.user.email, id, JSON.stringify({ name, duration, priceCents, professionalIds: professionalIds.value })),
  ]);
  return Response.json({ service: { id, name, description, durationMinutes: duration, priceCents, professionalIds: professionalIds.value } }, { status: 201 });
}

async function resolveProfessionalIds(d1: D1Database, tenantId: string, value: unknown) {
  const explicitlySelected = Array.isArray(value);
  const requested = explicitlySelected
    ? [...new Set(value.map((item) => cleanText(item, 100)).filter(Boolean))]
    : [];
  const rows = await d1.prepare("SELECT id FROM professionals WHERE tenant_id = ? AND is_active = 1 ORDER BY sort_order, name")
    .bind(tenantId).all<{ id: string }>();
  const allowed = new Set(rows.results.map((professional) => professional.id));
  const selected = explicitlySelected ? requested : [...allowed];
  if (selected.some((professionalId) => !allowed.has(professionalId))) {
    return { error: jsonError("Um dos profissionais não pertence a esta empresa.", 400, "INVALID_PROFESSIONAL_SCOPE") } as const;
  }
  return { value: selected } as const;
}
