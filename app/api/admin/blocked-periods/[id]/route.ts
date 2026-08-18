import { adminTenant } from "@/lib/admin-auth";
import { getD1 } from "@/lib/d1";
import { cleanText, jsonError } from "@/lib/http";
import { rejectCrossSiteMutation } from "@/lib/auth/request";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const d1 = await getD1();
  const { id } = await context.params;
  const current = await d1.prepare("SELECT * FROM blocked_periods WHERE id = ? AND tenant_id = ? LIMIT 1").bind(id, access.tenant.id).first<Record<string, unknown>>();
  if (!current) return jsonError("Bloqueio não encontrado.", 404, "BLOCK_NOT_FOUND");
  const payload = await request.json() as Record<string, unknown>;
  const professionalId = payload.professionalId === null ? null : (cleanText(payload.professionalId ?? current.professional_id, 100) || null);
  const startsAt = new Date(String(payload.startsAtUtc ?? current.starts_at_utc));
  const endsAt = new Date(String(payload.endsAtUtc ?? current.ends_at_utc));
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || startsAt >= endsAt) return jsonError("Informe um período válido.");
  if (professionalId) {
    const professional = await d1.prepare("SELECT id FROM professionals WHERE id = ? AND tenant_id = ? LIMIT 1").bind(professionalId, access.tenant.id).first();
    if (!professional) return jsonError("Profissional não pertence a esta empresa.", 404, "PROFESSIONAL_NOT_FOUND");
  }
  await d1.batch([
    d1.prepare("UPDATE blocked_periods SET professional_id = ?, starts_at_utc = ?, ends_at_utc = ?, reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?")
      .bind(professionalId, startsAt.toISOString(), endsAt.toISOString(), cleanText(payload.reason ?? current.reason, 300) || "Bloqueio manual", id, access.tenant.id),
    d1.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, 'blocked_period.updated', 'blocked_period', ?, '{}')")
      .bind(crypto.randomUUID(), access.tenant.id, access.user.email, id),
  ]);
  return Response.json({ saved: true, id });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const d1 = await getD1();
  const { id } = await context.params;
  const result = await d1.prepare("DELETE FROM blocked_periods WHERE id = ? AND tenant_id = ?").bind(id, access.tenant.id).run();
  if (!result.meta.changes) return jsonError("Bloqueio não encontrado.", 404, "BLOCK_NOT_FOUND");
  await d1.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, 'blocked_period.deleted', 'blocked_period', ?, '{}')")
    .bind(crypto.randomUUID(), access.tenant.id, access.user.email, id).run();
  return Response.json({ deleted: true, id });
}
