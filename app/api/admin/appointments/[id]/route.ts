import { adminTenant } from "@/lib/admin-auth";
import { getD1 } from "@/lib/d1";
import { jsonError } from "@/lib/http";
import { rejectCrossSiteMutation } from "@/lib/auth/request";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const d1 = await getD1();
  const { id } = await context.params;
  const payload = await request.json() as { status?: string };
  const allowed = ["pending", "confirmed", "cancelled", "completed", "no_show"];
  if (!allowed.includes(payload.status ?? "")) return jsonError("Status inválido.");
  const result = await d1.prepare("UPDATE appointments SET status = ?, cancelled_at = CASE WHEN ? = 'cancelled' THEN CURRENT_TIMESTAMP ELSE cancelled_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?")
    .bind(payload.status, payload.status, id, access.tenant.id).run();
  if (!result.meta.changes) return jsonError("Agendamento não encontrado.", 404, "APPOINTMENT_NOT_FOUND");
  await d1.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, 'appointment.status.updated', 'appointment', ?, ?)")
    .bind(crypto.randomUUID(), access.tenant.id, access.user.email, id, JSON.stringify({ status: payload.status })).run();
  return Response.json({ appointment: { id, status: payload.status } });
}
