import { decryptSecret } from "@/lib/crypto-secrets";
import { getD1 } from "@/lib/d1";
import { sendEmail } from "@/lib/integrations/email";
import { createGoogleCalendarEvent } from "@/lib/integrations/google-calendar";
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
  const connection = await d1.prepare("SELECT encrypted_credentials FROM integration_connections WHERE tenant_id = ? AND professional_id = ? AND provider = 'google_calendar' AND status = 'connected' LIMIT 1")
    .bind(tenantId, payload.professionalId).first<{ encrypted_credentials: string | null }>();
  if (!connection?.encrypted_credentials) return;
  const credentials = await decryptSecret<{ refreshToken: string; calendarId?: string }>(connection.encrypted_credentials);
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
    d1.prepare("INSERT INTO notification_deliveries (id, tenant_id, appointment_id, channel, recipient, status, provider_reference, sent_at) VALUES (?, ?, ?, 'calendar', ?, 'sent', ?, CURRENT_TIMESTAMP)")
      .bind(crypto.randomUUID(), tenantId, payload.appointmentId, payload.customerEmail, eventId),
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
