import { adminTenant } from "@/lib/admin-auth";
import { getD1 } from "@/lib/d1";
import { cleanText, isEmail, jsonError, normalizeEmail } from "@/lib/http";
import { rejectCrossSiteMutation } from "@/lib/auth/request";

type ServiceOverride = {
  serviceId?: string;
  durationMinutes?: number | null;
  priceCents?: number | null;
  bufferBeforeMinutes?: number | null;
  bufferAfterMinutes?: number | null;
};

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const d1 = await getD1();
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const { id } = await context.params;
  const current = await d1.prepare("SELECT * FROM professionals WHERE id = ? AND tenant_id = ? LIMIT 1")
    .bind(id, access.tenant.id).first<Record<string, unknown>>();
  if (!current) return jsonError("Profissional não encontrado.", 404, "PROFESSIONAL_NOT_FOUND");

  const payload = await request.json() as Record<string, unknown>;
  const name = cleanText(payload.name ?? current.name, 120);
  const title = cleanText(payload.title ?? current.title, 120) || "Profissional";
  const bio = cleanText(payload.bio ?? current.bio, 800);
  const email = normalizeEmail(payload.email ?? current.email);
  const color = cleanText(payload.color ?? current.color, 20) || "#17624f";
  const active = typeof payload.isActive === "boolean" ? payload.isActive : Boolean(current.is_active);
  if (!name || (email && !isEmail(email))) return jsonError("Informe nome e e-mail válidos.");
  if (active && !Boolean(current.is_active)) {
    const usage = await d1.prepare("SELECT COUNT(*) AS total FROM professionals WHERE tenant_id = ? AND is_active = 1")
      .bind(access.tenant.id).first<{ total: number }>();
    if (Number(usage?.total ?? 0) >= Number(access.tenant.maxProfessionals)) {
      return jsonError(`O plano atual permite até ${access.tenant.maxProfessionals} profissionais ativos.`, 409, "PROFESSIONAL_LIMIT_REACHED");
    }
  }

  const statements = [
    d1.prepare(`
      UPDATE professionals
      SET name = ?, title = ?, bio = ?, email = ?, color = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `).bind(name, title, bio, email, color, active ? 1 : 0, id, access.tenant.id),
  ];

  let selectedServiceIds: string[] | undefined;
  if (Array.isArray(payload.serviceIds)) {
    selectedServiceIds = [...new Set(payload.serviceIds.map((item) => cleanText(item, 100)).filter(Boolean))];
    if (selectedServiceIds.length > 100) return jsonError("Selecione no máximo 100 atividades.");
    const allowedResult = await d1.prepare("SELECT id FROM services WHERE tenant_id = ?")
      .bind(access.tenant.id).all<{ id: string }>();
    const allowed = new Set(allowedResult.results.map((service) => service.id));
    if (selectedServiceIds.some((serviceId) => !allowed.has(serviceId))) {
      return jsonError("Uma das atividades não pertence a esta empresa.", 400, "INVALID_SERVICE_SCOPE");
    }

    const overrides = parseOverrides(payload.serviceOverrides);
    statements.push(d1.prepare("DELETE FROM professional_services WHERE tenant_id = ? AND professional_id = ?")
      .bind(access.tenant.id, id));
    for (const serviceId of selectedServiceIds) {
      const override = overrides.get(serviceId);
      statements.push(d1.prepare(`
        INSERT INTO professional_services (
          id, tenant_id, professional_id, service_id,
          duration_minutes, price_cents, buffer_before_minutes, buffer_after_minutes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        access.tenant.id,
        id,
        serviceId,
        override?.durationMinutes ?? null,
        override?.priceCents ?? null,
        override?.bufferBeforeMinutes ?? null,
        override?.bufferAfterMinutes ?? null,
      ));
    }
  }

  statements.push(d1.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, 'professional.updated', 'professional', ?, ?)")
    .bind(crypto.randomUUID(), access.tenant.id, access.user.email, id, JSON.stringify({ name, title, active, serviceIds: selectedServiceIds })));
  await d1.batch(statements);

  return Response.json({
    professional: { id, name, title, bio, email, color, isActive: active, serviceIds: selectedServiceIds },
  });
}

function parseOverrides(value: unknown) {
  const overrides = new Map<string, ServiceOverride>();
  if (!Array.isArray(value)) return overrides;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as ServiceOverride;
    const serviceId = cleanText(candidate.serviceId, 100);
    if (!serviceId) continue;
    const durationMinutes = optionalInteger(candidate.durationMinutes, 5, 720);
    const priceCents = optionalInteger(candidate.priceCents, 0, 100_000_000);
    const bufferBeforeMinutes = optionalInteger(candidate.bufferBeforeMinutes, 0, 240);
    const bufferAfterMinutes = optionalInteger(candidate.bufferAfterMinutes, 0, 240);
    overrides.set(serviceId, { serviceId, durationMinutes, priceCents, bufferBeforeMinutes, bufferAfterMinutes });
  }
  return overrides;
}

function optionalInteger(value: unknown, minimum: number, maximum: number) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}
