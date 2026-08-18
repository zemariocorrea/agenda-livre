import { adminTenant } from "@/lib/admin-auth";
import { getD1 } from "@/lib/d1";
import { cleanText, isEmail, jsonError, normalizeEmail } from "@/lib/http";
import { rejectCrossSiteMutation } from "@/lib/auth/request";

export async function GET(request: Request) {
  const d1 = await getD1();
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;

  const [professionalsResult, linksResult] = await d1.batch([
    d1.prepare(`
      SELECT
        professional.id,
        professional.name,
        professional.title,
        professional.bio,
        professional.email,
        professional.color,
        professional.is_active,
        professional.sort_order,
        connection.status AS google_status,
        connection.last_synced_at AS google_last_synced_at
      FROM professionals AS professional
      LEFT JOIN integration_connections AS connection
        ON connection.tenant_id = professional.tenant_id
       AND connection.professional_id = professional.id
       AND connection.provider = 'google_calendar'
      WHERE professional.tenant_id = ?
      ORDER BY professional.sort_order, professional.name
    `).bind(access.tenant.id),
    d1.prepare(`
      SELECT professional_id, service_id, duration_minutes, price_cents,
             buffer_before_minutes, buffer_after_minutes, is_active
      FROM professional_services
      WHERE tenant_id = ?
      ORDER BY created_at
    `).bind(access.tenant.id),
  ]);

  const links = linksResult.results as Array<Record<string, unknown>>;
  const professionals = (professionalsResult.results as Array<Record<string, unknown>>).map((professional) => ({
    ...professional,
    service_ids: links
      .filter((link) => link.professional_id === professional.id && Boolean(link.is_active))
      .map((link) => String(link.service_id)),
    service_overrides: links
      .filter((link) => link.professional_id === professional.id)
      .map((link) => ({
        serviceId: String(link.service_id),
        durationMinutes: link.duration_minutes == null ? null : Number(link.duration_minutes),
        priceCents: link.price_cents == null ? null : Number(link.price_cents),
        bufferBeforeMinutes: link.buffer_before_minutes == null ? null : Number(link.buffer_before_minutes),
        bufferAfterMinutes: link.buffer_after_minutes == null ? null : Number(link.buffer_after_minutes),
        isActive: Boolean(link.is_active),
      })),
  }));
  return Response.json({ professionals });
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const d1 = await getD1();
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;

  const payload = await request.json() as Record<string, unknown>;
  const name = cleanText(payload.name, 120);
  const title = cleanText(payload.title, 120) || "Profissional";
  const bio = cleanText(payload.bio, 800);
  const email = normalizeEmail(payload.email);
  const color = cleanText(payload.color, 20) || "#17624f";
  if (!name || (email && !isEmail(email))) return jsonError("Informe nome e e-mail válidos.");

  const usage = await d1.prepare("SELECT COUNT(*) AS total FROM professionals WHERE tenant_id = ? AND is_active = 1")
    .bind(access.tenant.id).first<{ total: number }>();
  if (Number(usage?.total ?? 0) >= Number(access.tenant.maxProfessionals)) {
    return jsonError(`O plano atual permite até ${access.tenant.maxProfessionals} profissionais ativos.`, 409, "PROFESSIONAL_LIMIT_REACHED");
  }

  const serviceIds = await resolveServiceIds(d1, access.tenant.id, payload.serviceIds);
  if ("error" in serviceIds) return serviceIds.error;
  const id = crypto.randomUUID();
  const statements = [
    d1.prepare(`
      INSERT INTO professionals (id, tenant_id, name, title, bio, email, color, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM professionals WHERE tenant_id = ?), 1))
    `).bind(id, access.tenant.id, name, title, bio, email, color, access.tenant.id),
    ...serviceIds.value.map((serviceId) => d1.prepare(`
      INSERT INTO professional_services (id, tenant_id, professional_id, service_id)
      VALUES (?, ?, ?, ?)
    `).bind(crypto.randomUUID(), access.tenant.id, id, serviceId)),
    d1.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, 'professional.created', 'professional', ?, ?)")
      .bind(crypto.randomUUID(), access.tenant.id, access.user.email, id, JSON.stringify({ name, title, serviceIds: serviceIds.value })),
  ];
  await d1.batch(statements);

  return Response.json({
    professional: { id, name, title, bio, email, color, isActive: true, serviceIds: serviceIds.value },
  }, { status: 201 });
}

async function resolveServiceIds(d1: D1Database, tenantId: string, value: unknown) {
  const explicitlySelected = Array.isArray(value);
  const requested = explicitlySelected
    ? [...new Set(value.map((item) => cleanText(item, 100)).filter(Boolean))]
    : [];
  if (requested.length > 100) return { error: jsonError("Selecione no máximo 100 atividades.") } as const;

  const activeServices = await d1.prepare("SELECT id FROM services WHERE tenant_id = ? AND is_active = 1 ORDER BY sort_order, name")
    .bind(tenantId).all<{ id: string }>();
  const allowed = new Set(activeServices.results.map((service) => service.id));
  const selected = explicitlySelected ? requested : [...allowed];
  if (selected.some((serviceId) => !allowed.has(serviceId))) {
    return { error: jsonError("Uma das atividades não pertence a esta empresa.", 400, "INVALID_SERVICE_SCOPE") } as const;
  }
  return { value: selected } as const;
}
