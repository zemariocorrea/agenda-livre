import { getD1 } from "@/lib/d1";
import { jsonError } from "@/lib/http";

export async function PATCH(request: Request, context: { params: Promise<{ token: string }> }) {
  const d1 = await getD1();
  const { token } = await context.params;
  const payload = await request.json().catch(() => null) as { action?: string } | null;
  if (payload?.action !== "proof_sent") return jsonError("Ação de pagamento inválida.");

  const appointment = await d1.prepare(`
    SELECT id, tenant_id, status, payment_method, payment_status
    FROM appointments
    WHERE public_token = ?
    LIMIT 1
  `).bind(token).first<{
    id: string;
    tenant_id: string;
    status: string;
    payment_method: string | null;
    payment_status: string;
  }>();

  if (!appointment) return jsonError("Agendamento não encontrado.", 404, "APPOINTMENT_NOT_FOUND");
  if (appointment.status === "cancelled") return jsonError("Este agendamento foi cancelado.", 409, "APPOINTMENT_CANCELLED");
  if (appointment.payment_method !== "pix") return jsonError("Este agendamento não está aguardando Pix.", 409, "PIX_NOT_EXPECTED");
  if (appointment.payment_status === "paid") return Response.json({ paymentStatus: "paid" });

  await d1.batch([
    d1.prepare(`
      UPDATE appointments
      SET payment_status = 'proof_sent', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `).bind(appointment.id, appointment.tenant_id),
    d1.prepare(`
      INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json)
      VALUES (?, ?, 'public', 'appointment.payment.reported', 'appointment', ?, ?)
    `).bind(
      crypto.randomUUID(),
      appointment.tenant_id,
      appointment.id,
      JSON.stringify({ source: "customer", proofAttached: false }),
    ),
  ]);

  return Response.json({ paymentStatus: "proof_sent" });
}
