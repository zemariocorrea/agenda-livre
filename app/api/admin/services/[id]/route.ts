import { adminTenant } from "@/lib/admin-auth";
import { getD1 } from "@/lib/d1";
import { cleanText, jsonError } from "@/lib/http";
import { rejectCrossSiteMutation } from "@/lib/auth/request";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const d1 = await getD1();
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const { id } = await context.params;
  const payload = await request.json() as Record<string, unknown>;
  const current = await d1.prepare("SELECT * FROM services WHERE id = ? AND tenant_id = ? LIMIT 1").bind(id, access.tenant.id).first<Record<string, unknown>>();
  if (!current) return jsonError("Atividade não encontrada.", 404, "SERVICE_NOT_FOUND");
  const name = cleanText(payload.name ?? current.name, 120);
  const description = cleanText(payload.description ?? current.description, 500);
  const duration = Number(payload.durationMinutes ?? current.duration_minutes);
  const priceCents = Number(payload.priceCents ?? current.price_cents);
  const active = typeof payload.isActive === "boolean" ? payload.isActive : Boolean(current.is_active);
  if (!name || !Number.isInteger(duration) || duration < 5 || duration > 720 || !Number.isInteger(priceCents) || priceCents < 0) return jsonError("Informe nome, duração e preço válidos.");
  const professionalIds = Array.isArray(payload.professionalIds)
    ? [...new Set(payload.professionalIds.map((item) => cleanText(item, 100)).filter(Boolean))]
    : undefined;
  if (professionalIds) {
    const rows = await d1.prepare("SELECT id FROM professionals WHERE tenant_id = ?")
      .bind(access.tenant.id).all<{ id: string }>();
    const allowed = new Set(rows.results.map((professional) => professional.id));
    if (professionalIds.some((professionalId) => !allowed.has(professionalId))) {
      return jsonError("Um dos profissionais não pertence a esta empresa.", 400, "INVALID_PROFESSIONAL_SCOPE");
    }
  }
  const statements = [
    d1.prepare("UPDATE services SET name = ?, description = ?, duration_minutes = ?, price_cents = ?, color = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?")
      .bind(name, description, duration, priceCents, cleanText(payload.color ?? current.color, 20) || "#17624f", active ? 1 : 0, id, access.tenant.id),
  ];
  if (professionalIds) {
    statements.push(d1.prepare("UPDATE professional_services SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND service_id = ?")
      .bind(access.tenant.id, id));
    for (const professionalId of professionalIds) {
      statements.push(d1.prepare(`
        INSERT INTO professional_services (id, tenant_id, professional_id, service_id, is_active)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT (professional_id, service_id)
        DO UPDATE SET is_active = 1, updated_at = CURRENT_TIMESTAMP
      `).bind(crypto.randomUUID(), access.tenant.id, professionalId, id));
    }
  }
  statements.push(
    d1.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, 'service.updated', 'service', ?, ?)")
      .bind(crypto.randomUUID(), access.tenant.id, access.user.email, id, JSON.stringify({ name, duration, priceCents, active, professionalIds })),
  );
  await d1.batch(statements);
  return Response.json({ service: { id, name, description, durationMinutes: duration, priceCents, isActive: active, professionalIds } });
}
