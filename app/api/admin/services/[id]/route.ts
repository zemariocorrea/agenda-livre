import { adminTenant } from "@/lib/admin-auth";
import { getD1 } from "@/lib/d1";
import { cleanText, jsonError } from "@/lib/http";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
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
  await d1.batch([
    d1.prepare("UPDATE services SET name = ?, description = ?, duration_minutes = ?, price_cents = ?, color = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?")
      .bind(name, description, duration, priceCents, cleanText(payload.color ?? current.color, 20) || "#17624f", active ? 1 : 0, id, access.tenant.id),
    d1.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, 'service.updated', 'service', ?, ?)")
      .bind(crypto.randomUUID(), access.tenant.id, access.user.email, id, JSON.stringify({ name, duration, priceCents, active })),
  ]);
  return Response.json({ service: { id, name, description, durationMinutes: duration, priceCents, isActive: active } });
}
