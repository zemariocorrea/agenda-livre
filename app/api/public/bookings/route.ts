import { googleCalendarLink } from "@/lib/calendar-link";
import { listAvailableSlotsForService } from "@/lib/availability";
import { getD1 } from "@/lib/d1";
import { cleanText, isEmail, jsonError, normalizeEmail } from "@/lib/http";
import { createStripeCheckout } from "@/lib/integrations/stripe";
import { addMinutes, dateKeyInTimeZone } from "@/lib/timezone";

type BookingPayload = {
  tenantSlug?: string;
  serviceId?: string;
  professionalId?: string;
  startsAtUtc?: string;
  customer?: { name?: string; email?: string; phone?: string; notes?: string };
  paymentPreference?: "online" | "at_venue";
};

export async function POST(request: Request) {
  const d1 = await getD1();
  const idempotencyKey = cleanText(request.headers.get("Idempotency-Key"), 120) || crypto.randomUUID();
  let payload: BookingPayload;
  try {
    payload = await request.json() as BookingPayload;
  } catch {
    return jsonError("O conteúdo enviado não é um JSON válido.");
  }

  const tenantSlug = cleanText(payload.tenantSlug, 100) || "clinica-aurora";
  const serviceId = cleanText(payload.serviceId, 100);
  const requestedProfessionalId = cleanText(payload.professionalId, 100) || undefined;
  const name = cleanText(payload.customer?.name, 120);
  const email = normalizeEmail(payload.customer?.email);
  const phone = cleanText(payload.customer?.phone, 40);
  const notes = cleanText(payload.customer?.notes, 1000);
  const startsAt = new Date(payload.startsAtUtc ?? "");
  const paymentPreference = payload.paymentPreference === "online" ? "online" : "at_venue";
  if (!serviceId || !name || !isEmail(email) || !phone || Number.isNaN(startsAt.getTime())) {
    return jsonError("Preencha serviço, horário, nome, e-mail e celular corretamente.");
  }

  const tenant = await d1.prepare(`
    SELECT id, name, timezone, currency, location
    FROM tenants
    WHERE slug = ? AND is_active = 1
    LIMIT 1
  `).bind(tenantSlug).first<{
    id: string;
    name: string;
    timezone: string;
    currency: string;
    location: string;
  }>();
  if (!tenant) return jsonError("Empresa não encontrada.", 404, "TENANT_NOT_FOUND");

  const existing = await d1.prepare(`
    SELECT response_json
    FROM idempotency_keys
    WHERE tenant_id = ? AND scope = 'booking.create' AND key = ? AND datetime(expires_at) > CURRENT_TIMESTAMP
    LIMIT 1
  `).bind(tenant.id, idempotencyKey).first<{ response_json: string }>();
  if (existing) return Response.json(JSON.parse(existing.response_json), { status: 200 });

  const service = await d1.prepare(`
    SELECT id, name
    FROM services
    WHERE id = ? AND tenant_id = ? AND is_active = 1
    LIMIT 1
  `).bind(serviceId, tenant.id).first<{ id: string; name: string }>();
  if (!service) return jsonError("Serviço não encontrado.", 404, "SERVICE_NOT_FOUND");

  const localDate = dateKeyInTimeZone(startsAt, tenant.timezone);
  const availability = await listAvailableSlotsForService(d1, {
    tenantId: tenant.id,
    serviceId: service.id,
    professionalId: requestedProfessionalId,
    timezone: tenant.timezone,
    localDate,
  });
  if (!availability.professionals.length) {
    return jsonError("Nenhum profissional ativo atende esta atividade.", 409, "NO_ACTIVE_PROFESSIONAL");
  }
  const selectedSlot = availability.slots.find((slot) => slot.startsAtUtc === startsAt.toISOString());
  if (!selectedSlot) {
    return jsonError("Esse horário não está disponível. Escolha uma opção atualizada.", 409, "SLOT_UNAVAILABLE");
  }
  const professional = availability.professionals.find((item) => item.id === selectedSlot.professionalId);
  if (!professional) {
    return jsonError("O profissional selecionado não está mais disponível.", 409, "PROFESSIONAL_UNAVAILABLE");
  }

  const tenantOwner = await d1.prepare(`
    SELECT email
    FROM tenant_members
    WHERE tenant_id = ? AND is_active = 1
    ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at
    LIMIT 1
  `).bind(tenant.id).first<{ email: string }>();
  const notificationEmail = professional.email || tenantOwner?.email || email;

  const appointmentId = crypto.randomUUID();
  const publicToken = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  const endsAt = new Date(selectedSlot.endsAtUtc);
  const busyStartsAt = addMinutes(startsAt, -professional.bufferBeforeMinutes);
  const busyEndsAt = addMinutes(endsAt, professional.bufferAfterMinutes);
  const onlinePayment = paymentPreference === "online" && professional.priceCents > 0;
  const paymentStatus = onlinePayment ? "pending" : "not_required";
  const calendarUrl = googleCalendarLink({
    title: `${service.name} · ${tenant.name}`,
    startsAtUtc: startsAt.toISOString(),
    endsAtUtc: endsAt.toISOString(),
    details: `Agendamento com ${professional.name} confirmado para ${name}.`,
    location: tenant.location,
  });
  const responsePayload: Record<string, unknown> = {
    appointment: {
      id: appointmentId,
      publicToken,
      status: "confirmed",
      startsAtUtc: startsAt.toISOString(),
      endsAtUtc: endsAt.toISOString(),
      timezone: tenant.timezone,
      serviceName: service.name,
      professionalId: professional.id,
      professionalName: professional.name,
      customerName: name,
      paymentPreference,
      paymentStatus,
      priceCents: professional.priceCents,
    },
    calendarUrl,
  };

  const eventPayload = JSON.stringify({
    appointmentId,
    tenantId: tenant.id,
    professionalId: professional.id,
    professionalName: professional.name,
    serviceName: service.name,
    customerName: name,
    customerEmail: email,
    customerPhone: phone,
    adminEmail: notificationEmail,
    startsAtUtc: startsAt.toISOString(),
    endsAtUtc: endsAt.toISOString(),
    timezone: tenant.timezone,
    location: tenant.location,
  });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const statements = [
    d1.prepare(`
      INSERT INTO appointments (
        id, tenant_id, service_id, professional_id,
        customer_name, customer_email, customer_phone, customer_notes,
        starts_at_utc, ends_at_utc, busy_starts_at_utc, busy_ends_at_utc,
        duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents,
        timezone, status, payment_preference, payment_status, public_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)
    `).bind(
      appointmentId,
      tenant.id,
      service.id,
      professional.id,
      name,
      email,
      phone,
      notes,
      startsAt.toISOString(),
      endsAt.toISOString(),
      busyStartsAt.toISOString(),
      busyEndsAt.toISOString(),
      professional.durationMinutes,
      professional.bufferBeforeMinutes,
      professional.bufferAfterMinutes,
      professional.priceCents,
      tenant.timezone,
      paymentPreference,
      paymentStatus,
      publicToken,
    ),
    d1.prepare("INSERT INTO outbox_events (id, tenant_id, aggregate_type, aggregate_id, event_type, payload_json) VALUES (?, ?, 'appointment', ?, 'appointment.created', ?)")
      .bind(crypto.randomUUID(), tenant.id, appointmentId, eventPayload),
    d1.prepare("INSERT INTO outbox_events (id, tenant_id, aggregate_type, aggregate_id, event_type, payload_json) VALUES (?, ?, 'appointment', ?, 'notification.customer.confirmation', ?)")
      .bind(crypto.randomUUID(), tenant.id, appointmentId, eventPayload),
    d1.prepare("INSERT INTO outbox_events (id, tenant_id, aggregate_type, aggregate_id, event_type, payload_json) VALUES (?, ?, 'appointment', ?, 'notification.admin.new_booking', ?)")
      .bind(crypto.randomUUID(), tenant.id, appointmentId, eventPayload),
    d1.prepare("INSERT INTO notification_deliveries (id, tenant_id, appointment_id, channel, recipient) VALUES (?, ?, ?, 'email', ?)")
      .bind(crypto.randomUUID(), tenant.id, appointmentId, email),
    d1.prepare("INSERT INTO notification_deliveries (id, tenant_id, appointment_id, channel, recipient) VALUES (?, ?, ?, 'in_app', ?)")
      .bind(crypto.randomUUID(), tenant.id, appointmentId, notificationEmail),
    d1.prepare("INSERT INTO idempotency_keys (id, tenant_id, scope, key, resource_id, response_json, expires_at) VALUES (?, ?, 'booking.create', ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), tenant.id, idempotencyKey, appointmentId, JSON.stringify(responsePayload), expiresAt),
  ];
  if (onlinePayment) {
    statements.push(d1.prepare("INSERT INTO payments (id, tenant_id, appointment_id, amount_cents, currency, status) VALUES (?, ?, ?, ?, ?, 'pending')")
      .bind(paymentId, tenant.id, appointmentId, professional.priceCents, tenant.currency));
  }

  try {
    await d1.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("APPOINTMENT_CONFLICT")
      || message.includes("BLOCKED_PERIOD_CONFLICT")
      || message.includes("idempotency_tenant_scope_key_uq")
      || message.includes("UNIQUE constraint failed: idempotency_keys")
    ) {
      const completed = await d1.prepare("SELECT response_json FROM idempotency_keys WHERE tenant_id = ? AND scope = 'booking.create' AND key = ? LIMIT 1")
        .bind(tenant.id, idempotencyKey).first<{ response_json: string }>();
      if (completed) return Response.json(JSON.parse(completed.response_json), { status: 200 });
      return jsonError("Esse horário acabou de ser ocupado. Escolha outro horário.", 409, "SLOT_CONFLICT");
    }
    throw error;
  }

  if (onlinePayment) {
    try {
      const origin = new URL(request.url).origin;
      const checkout = await createStripeCheckout({
        appointmentId,
        customerEmail: email,
        serviceName: service.name,
        amountCents: professional.priceCents,
        currency: tenant.currency,
        successUrl: `${origin}/agendamento/${publicToken}?payment=success`,
        cancelUrl: `${origin}/agendamento/${publicToken}?payment=cancelled`,
        idempotencyKey: `booking-${appointmentId}`,
      });
      if (checkout) {
        await d1.prepare("UPDATE payments SET provider_reference = ?, checkout_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(checkout.id, checkout.url, paymentId).run();
        responsePayload.checkoutUrl = checkout.url;
      } else {
        responsePayload.paymentFallback = "Pagamento online ainda não configurado; o horário permanece confirmado para pagamento no atendimento.";
      }
    } catch {
      responsePayload.paymentFallback = "Não foi possível abrir o pagamento agora; o horário permanece confirmado para pagamento no atendimento.";
    }
  }

  await d1.prepare("UPDATE idempotency_keys SET response_json = ? WHERE tenant_id = ? AND scope = 'booking.create' AND key = ?")
    .bind(JSON.stringify(responsePayload), tenant.id, idempotencyKey).run();

  return Response.json(responsePayload, {
    status: 201,
    headers: { "Idempotency-Key": idempotencyKey },
  });
}
