import { getD1 } from "@/lib/d1";
import { sendEmail } from "@/lib/integrations/email";
import { createGoogleCalendarEvent, deleteGoogleCalendarEvent } from "@/lib/integrations/google-calendar";
import { googleCredentialsFromConnection, resolveGoogleConnection, type GoogleConnectionRow } from "@/lib/integrations/google-connection";
import { formatInTimeZone } from "@/lib/timezone";

type EventPayload = {
  appointmentId: string;
  professionalId: string;
  professionalName: string;
  serviceName: string;
  customerName: string;
  customerEmail: string;
  adminEmail: string;
  startsAtUtc: string;
  endsAtUtc: string;
  timezone: string;
  location: string;
  googleEventId?: string | null;
};

export async function POST(request: Request) {
  const d1 = await getD1();
  const expected = process.env.OUTBOX_SECRET;
  if (!expected) return Response.json({ error: "OUTBOX_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("Authorization") !== `Bearer ${expected}`) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const rows = await d1.prepare("SELECT id, tenant_id, event_type, payload_json, attempts FROM outbox_events WHERE ((status IN ('pending', 'failed') AND available_at <= CURRENT_TIMESTAMP) OR (status = 'processing' AND updated_at < datetime('now', '-10 minutes'))) AND attempts < 5 ORDER BY created_at LIMIT 20").all<{ id: string; tenant_id: string; event_type: string; payload_json: string; attempts: number }>();
  const results: Array<{ id: string; status: string; error?: string }> = [];
  for (const event of rows.results) {
    const lock = await d1.prepare("UPDATE outbox_events SET status = 'processing', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (status IN ('pending', 'failed') OR (status = 'processing' AND updated_at < datetime('now', '-10 minutes')))").bind(event.id).run();
    if (!lock.meta.changes) continue;
    try {
      const payload = JSON.parse(event.payload_json) as EventPayload;
      if (event.event_type === "appointment.created") await syncCalendar(event.tenant_id, payload);
      if (event.event_type === "appointment.cancelled") await cancelCalendar(event.tenant_id, payload);
      if (event.event_type === "notification.customer.confirmation") await notifyCustomer(event.id, payload);
      if (event.event_type === "notification.admin.new_booking") await notifyAdmin(event.id, payload);
      await d1.prepare("UPDATE outbox_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(event.id).run();
      results.push({ id: event.id, status: "processed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const delayMinutes = Math.min(60, 2 ** (event.attempts + 1));
      await d1.prepare("UPDATE outbox_events SET status = 'failed', last_error = ?, available_at = datetime('now', ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(message.slice(0, 800), `+${delayMinutes} minutes`, event.id).run();
      results.push({ id: event.id, status: "failed", error: message });
    }
  }
  return Response.json({ processed: results.length, results });
}

async function syncCalendar(tenantId: string, payload: EventPayload) {
  const d1 = await getD1();
  const appointment = await d1.prepare("SELECT status FROM appointments WHERE id = ? AND tenant_id = ? LIMIT 1")
    .bind(payload.appointmentId, tenantId).first<{ status: string }>();
  if (!appointment || appointment.status === "cancelled") return;

  const connection = await resolveGoogleConnection(d1, {
    tenantId,
    professionalId: payload.professionalId,
    allowTenantFallback: true,
  });
  if (!connection) return;
  const credentials = await googleCredentialsFromConnection(connection);
  if (!credentials) return;

  const eventId = await createGoogleCalendarEvent(credentials, {
    appointmentId: payload.appointmentId,
    title: payload.serviceName,
    description: `Agendamento de ${payload.customerName} com ${payload.professionalName}`,
    location: payload.location,
    customerEmail: payload.customerEmail,
    startsAtUtc: payload.startsAtUtc,
    endsAtUtc: payload.endsAtUtc,
    timezone: payload.timezone,
  });
  await d1.batch([
    d1.prepare("UPDATE appointments SET google_event_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(eventId, payload.appointmentId),
    d1.prepare("UPDATE integration_connections SET last_synced_at = CURRENT_TIMESTAMP, status = 'connected', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(connection.id),
    d1.prepare("INSERT INTO notification_deliveries (id, tenant_id, appointment_id, channel, recipient, status, provider_reference, sent_at) VALUES (?, ?, ?, 'calendar', ?, 'sent', ?, CURRENT_TIMESTAMP)")
      .bind(
        crypto.randomUUID(),
        tenantId,
        payload.appointmentId,
        payload.customerEmail,
        JSON.stringify({ eventId, connectionId: connection.id, calendarId: credentials.calendarId ?? "primary" }),
      ),
  ]);
}

async function cancelCalendar(tenantId: string, payload: EventPayload) {
  const d1 = await getD1();
  const appointment = await d1.prepare("SELECT google_event_id FROM appointments WHERE id = ? AND tenant_id = ? LIMIT 1")
    .bind(payload.appointmentId, tenantId).first<{ google_event_id: string | null }>();
  const delivery = await d1.prepare(`
    SELECT provider_reference
    FROM notification_deliveries
    WHERE tenant_id = ? AND appointment_id = ? AND channel = 'calendar' AND status = 'sent'
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(tenantId, payload.appointmentId).first<{ provider_reference: string | null }>();

  let eventId = appointment?.google_event_id ?? payload.googleEventId ?? null;
  let connectionId: string | null = null;
  let originalCalendarId: string | null = null;
  if (delivery?.provider_reference) {
    try {
      const reference = JSON.parse(delivery.provider_reference) as { eventId?: string; connectionId?: string; calendarId?: string };
      eventId = reference.eventId ?? eventId;
      connectionId = reference.connectionId ?? null;
      originalCalendarId = reference.calendarId ?? null;
    } catch {
      eventId = delivery.provider_reference || eventId;
    }
  }
  if (!eventId) return;

  let connection = connectionId
    ? await d1.prepare(`
        SELECT id, tenant_id, professional_id, status, external_account_id,
               encrypted_credentials, configuration_json, last_synced_at
        FROM integration_connections
        WHERE id = ? AND tenant_id = ? AND provider = 'google_calendar' AND status = 'connected'
        LIMIT 1
      `).bind(connectionId, tenantId).first<GoogleConnectionRow>()
    : null;
  connection ??= await resolveGoogleConnection(d1, {
    tenantId,
    professionalId: payload.professionalId,
    allowTenantFallback: true,
  });
  if (!connection) return;
  const credentials = await googleCredentialsFromConnection(connection);
  if (!credentials) return;
  if (originalCalendarId) credentials.calendarId = originalCalendarId;

  await deleteGoogleCalendarEvent(credentials, eventId);
  await d1.batch([
    d1.prepare("UPDATE appointments SET google_event_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(payload.appointmentId),
    d1.prepare("UPDATE integration_connections SET last_synced_at = CURRENT_TIMESTAMP, status = 'connected', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(connection.id),
  ]);
}

function appointmentText(payload: EventPayload) {
  const when = formatInTimeZone(payload.startsAtUtc, payload.timezone, { dateStyle: "long", timeStyle: "short" });
  return { when, text: `${payload.serviceName} com ${payload.professionalName} em ${when}.` };
}

async function notifyCustomer(eventId: string, payload: EventPayload) {
  const d1 = await getD1();
  const { when, text } = appointmentText(payload);
  const providerId = await sendEmail({
    idempotencyKey: `outbox-${eventId}`,
    to: payload.customerEmail,
    subject: `Agendamento confirmado · ${payload.serviceName}`,
    text: `Olá, ${payload.customerName}. Seu agendamento está confirmado: ${text}`,
    html: `<h1>Horário confirmado</h1><p>Olá, ${escapeHtml(payload.customerName)}.</p><p><strong>${escapeHtml(payload.serviceName)}</strong><br>Profissional: ${escapeHtml(payload.professionalName)}<br>${escapeHtml(when)}</p>`,
  });
  if (!providerId) throw new Error("EMAIL_NOT_CONFIGURED");
  await d1.prepare("UPDATE notification_deliveries SET status = 'sent', provider_reference = ?, sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE appointment_id = ? AND channel = 'email' AND recipient = ?")
    .bind(providerId, payload.appointmentId, payload.customerEmail).run();
}

async function notifyAdmin(eventId: string, payload: EventPayload) {
  const { when } = appointmentText(payload);
  const providerId = await sendEmail({
    idempotencyKey: `outbox-${eventId}`,
    to: payload.adminEmail,
    subject: `Novo agendamento · ${payload.customerName}`,
    text: `${payload.customerName} marcou ${payload.serviceName} com ${payload.professionalName} para ${when}.`,
    html: `<h1>Novo agendamento</h1><p><strong>${escapeHtml(payload.customerName)}</strong> marcou ${escapeHtml(payload.serviceName)} com ${escapeHtml(payload.professionalName)}.</p><p>${escapeHtml(when)}</p>`,
  });
  if (!providerId) throw new Error("EMAIL_NOT_CONFIGURED");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}
