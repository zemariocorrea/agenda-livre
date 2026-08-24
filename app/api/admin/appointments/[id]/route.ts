import { adminTenant } from "@/lib/admin-auth";
import { getD1 } from "@/lib/d1";
import { jsonError } from "@/lib/http";
import { rejectCrossSiteMutation } from "@/lib/auth/request";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const url = new URL(request.url);
  const tenantSlug = url.searchParams.get("tenant");
  if (!tenantSlug) return jsonError("Informe a empresa.", 400, "TENANT_REQUIRED");
  const access = await adminTenant(tenantSlug);
  if ("error" in access) return access.error;

  const d1 = await getD1();
  const { id } = await context.params;
  const payload = await request.json() as { status?: string };
  const allowed = ["pending", "confirmed", "cancelled", "completed", "no_show"];
  if (!allowed.includes(payload.status ?? "")) return jsonError("Status inválido.");

  const appointment = await d1.prepare(`
    SELECT appointment.id, appointment.status, appointment.google_event_id,
           appointment.customer_name, appointment.customer_email, appointment.customer_phone,
           appointment.starts_at_utc, appointment.ends_at_utc, appointment.timezone,
           appointment.payment_method, appointment.payment_status,
           appointment.professional_id, professional.name AS professional_name,
           service.name AS service_name, tenant.location, tenant.require_payment_to_confirm
    FROM appointments AS appointment
    INNER JOIN professionals AS professional
      ON professional.id = appointment.professional_id AND professional.tenant_id = appointment.tenant_id
    INNER JOIN services AS service
      ON service.id = appointment.service_id AND service.tenant_id = appointment.tenant_id
    INNER JOIN tenants AS tenant ON tenant.id = appointment.tenant_id
    WHERE appointment.id = ? AND appointment.tenant_id = ?
    LIMIT 1
  `).bind(id, access.tenant.id).first<{
    id: string;
    status: string;
    google_event_id: string | null;
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    starts_at_utc: string;
    ends_at_utc: string;
    timezone: string;
    payment_method: string | null;
    payment_status: string;
    professional_id: string;
    professional_name: string;
    service_name: string;
    location: string;
    require_payment_to_confirm: number;
  }>();
  if (!appointment) return jsonError("Agendamento não encontrado.", 404, "APPOINTMENT_NOT_FOUND");
  if (
    payload.status === "confirmed"
    && Boolean(appointment.require_payment_to_confirm)
    && (appointment.payment_method === "pix" || appointment.payment_method === "contact")
    && appointment.payment_status !== "paid"
  ) {
    return jsonError("Confirme o pagamento antes de confirmar este agendamento.", 409, "PAYMENT_CONFIRMATION_REQUIRED");
  }

  const statements = [
    d1.prepare(`
      UPDATE appointments
      SET status = ?,
          cancelled_at = CASE
            WHEN ? = 'cancelled' THEN COALESCE(cancelled_at, CURRENT_TIMESTAMP)
            WHEN ? <> 'cancelled' THEN NULL
            ELSE cancelled_at
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `).bind(payload.status, payload.status, payload.status, id, access.tenant.id),
    d1.prepare(`
      INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json)
      VALUES (?, ?, ?, 'appointment.status.updated', 'appointment', ?, ?)
    `).bind(
      crypto.randomUUID(),
      access.tenant.id,
      access.user.email,
      id,
      JSON.stringify({ previousStatus: appointment.status, status: payload.status }),
    ),
  ];

  if (payload.status === "cancelled" && appointment.status !== "cancelled") {
    const eventPayload = JSON.stringify({
      appointmentId: appointment.id,
      professionalId: appointment.professional_id,
      professionalName: appointment.professional_name,
      serviceName: appointment.service_name,
      customerName: appointment.customer_name,
      customerEmail: appointment.customer_email,
      customerPhone: appointment.customer_phone,
      adminEmail: access.user.email,
      startsAtUtc: appointment.starts_at_utc,
      endsAtUtc: appointment.ends_at_utc,
      timezone: appointment.timezone,
      location: appointment.location,
      googleEventId: appointment.google_event_id,
    });
    statements.push(
      d1.prepare(`
        INSERT INTO outbox_events (id, tenant_id, aggregate_type, aggregate_id, event_type, payload_json)
        VALUES (?, ?, 'appointment', ?, 'appointment.cancelled', ?)
      `).bind(crypto.randomUUID(), access.tenant.id, appointment.id, eventPayload),
    );
  }

  await d1.batch(statements);
  return Response.json({ appointment: { id, status: payload.status } });
}
