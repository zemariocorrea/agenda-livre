import { getD1 } from "@/lib/d1";

type StripeEvent = { type?: string; data?: { object?: { id?: string; payment_status?: string; metadata?: { appointment_id?: string } } } };

export async function POST(request: Request) {
  const d1 = await getD1();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("Stripe-Signature");
  if (!secret || !signature) return Response.json({ error: "WEBHOOK_NOT_CONFIGURED" }, { status: 400 });
  const body = await request.text();
  if (!(await validSignature(body, signature, secret))) return Response.json({ error: "INVALID_SIGNATURE" }, { status: 400 });

  const event = JSON.parse(body) as StripeEvent;
  if (event.type === "checkout.session.completed" && event.data?.object?.payment_status === "paid") {
    const sessionId = event.data.object.id;
    const appointmentId = event.data.object.metadata?.appointment_id;
    if (sessionId && appointmentId) {
      const appointment = await d1.prepare("SELECT a.tenant_id, p.status AS payment_status FROM appointments a JOIN payments p ON p.appointment_id = a.id AND p.provider = 'stripe' WHERE a.id = ? AND p.provider_reference = ? LIMIT 1")
        .bind(appointmentId, sessionId).first<{ tenant_id: string; payment_status: string }>();
      if (appointment?.payment_status === "paid") return Response.json({ received: true, duplicate: true });
      if (appointment) await d1.batch([
        d1.prepare("UPDATE payments SET status = 'paid', paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE appointment_id = ? AND provider = 'stripe' AND provider_reference = ? AND status <> 'paid'").bind(appointmentId, sessionId),
        d1.prepare("UPDATE appointments SET payment_status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(appointmentId),
        d1.prepare("INSERT INTO outbox_events (id, tenant_id, aggregate_type, aggregate_id, event_type, payload_json) VALUES (?, ?, 'appointment', ?, 'payment.completed', ?)")
          .bind(crypto.randomUUID(), appointment.tenant_id, appointmentId, JSON.stringify({ appointmentId, provider: "stripe", sessionId })),
      ]);
    }
  }
  return Response.json({ received: true });
}

async function validSignature(body: string, header: string, secret: string) {
  const values = Object.fromEntries(header.split(",").map((item) => item.split("=", 2)));
  const timestamp = Number(values.t);
  if (!timestamp || !values.v1 || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const expected = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(expected, values.v1);
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
