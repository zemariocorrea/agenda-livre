import { adminTenant, requireTenantManager } from "@/lib/admin-auth";
import { rejectCrossSiteMutation } from "@/lib/auth/request";
import { getD1 } from "@/lib/d1";
import { jsonError } from "@/lib/http";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const forbidden = requireTenantManager(access.member.role);
  if (forbidden) return forbidden;

  const payload = await request.json().catch(() => null) as { action?: string } | null;
  if (payload?.action !== "confirm" && payload?.action !== "reject") return jsonError("Ação de pagamento inválida.");

  const { id } = await context.params;
  const d1 = await getD1();
  const appointment = await d1.prepare(`
    SELECT appointment.id, appointment.status, appointment.payment_method, appointment.payment_status,
           appointment.payment_amount_cents, appointment.customer_name, appointment.customer_email,
           appointment.customer_phone, appointment.starts_at_utc, appointment.ends_at_utc,
           appointment.timezone, appointment.professional_id, appointment.google_event_id,
           professional.name AS professional_name, service.name AS service_name,
           tenant.location, tenant.require_payment_to_confirm
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
    payment_method: string | null;
    payment_status: string;
    payment_amount_cents: number | null;
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    starts_at_utc: string;
    ends_at_utc: string;
    timezone: string;
    professional_id: string;
    google_event_id: string | null;
    professional_name: string;
    service_name: string;
    location: string;
    require_payment_to_confirm: number;
  }>();

  if (!appointment) return jsonError("Agendamento não encontrado.", 404, "APPOINTMENT_NOT_FOUND");
  if (!appointment.payment_method) return jsonError("Este agendamento não possui pagamento manual configurado.", 409, "MANUAL_PAYMENT_NOT_CONFIGURED");

  if (payload.action === "reject") {
    await d1.batch([
      d1.prepare(`
        UPDATE appointments
        SET payment_status = 'rejected', payment_confirmed_at = NULL, payment_confirmed_by = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ?
      `).bind(id, access.tenant.id),
      d1.prepare(`
        INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json)
        VALUES (?, ?, ?, 'appointment.payment.rejected', 'appointment', ?, ?)
      `).bind(
        crypto.randomUUID(),
        access.tenant.id,
        access.user.email,
        id,
        JSON.stringify({ previousPaymentStatus: appointment.payment_status, paymentMethod: appointment.payment_method }),
      ),
    ]);
    return Response.json({ appointment: { id, status: appointment.status, paymentStatus: "rejected" } });
  }

  if (appointment.payment_status === "paid") {
    return Response.json({ appointment: { id, status: appointment.status, paymentStatus: "paid" } });
  }

  const shouldConfirmAppointment = Boolean(appointment.require_payment_to_confirm) && appointment.status === "pending";
  const nextStatus = shouldConfirmAppointment ? "confirmed" : appointment.status;
  const statements = [
    d1.prepare(`
      UPDATE appointments
      SET payment_status = 'paid', payment_confirmed_at = CURRENT_TIMESTAMP, payment_confirmed_by = ?,
          status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `).bind(access.user.id, nextStatus, id, access.tenant.id),
    d1.prepare(`
      INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json)
      VALUES (?, ?, ?, 'appointment.payment.confirmed', 'appointment', ?, ?)
    `).bind(
      crypto.randomUUID(),
      access.tenant.id,
      access.user.email,
      id,
      JSON.stringify({
        previousPaymentStatus: appointment.payment_status,
        paymentMethod: appointment.payment_method,
        paymentAmountCents: appointment.payment_amount_cents,
        appointmentConfirmed: shouldConfirmAppointment,
      }),
    ),
  ];

  if (shouldConfirmAppointment) {
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
        VALUES (?, ?, 'appointment', ?, 'appointment.created', ?)
      `).bind(crypto.randomUUID(), access.tenant.id, id, eventPayload),
      d1.prepare(`
        INSERT INTO outbox_events (id, tenant_id, aggregate_type, aggregate_id, event_type, payload_json)
        VALUES (?, ?, 'appointment', ?, 'notification.customer.confirmation', ?)
      `).bind(crypto.randomUUID(), access.tenant.id, id, eventPayload),
      d1.prepare(`
        INSERT INTO notification_deliveries (id, tenant_id, appointment_id, channel, recipient)
        VALUES (?, ?, ?, 'email', ?)
      `).bind(crypto.randomUUID(), access.tenant.id, id, appointment.customer_email),
    );
  }

  await d1.batch(statements);
  return Response.json({ appointment: { id, status: nextStatus, paymentStatus: "paid" } });
}
