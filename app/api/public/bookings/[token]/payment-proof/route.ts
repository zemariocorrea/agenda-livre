import { getD1 } from "@/lib/d1";
import { jsonError } from "@/lib/http";
import { siteAssetsBucket } from "@/lib/r2-storage";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const d1 = await getD1();
  const { token } = await context.params;
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
  if (appointment.payment_status === "paid") return jsonError("O pagamento já foi confirmado.", 409, "PAYMENT_ALREADY_CONFIRMED");

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("Selecione o comprovante.", 400, "PAYMENT_PROOF_REQUIRED");
  if (!ALLOWED_TYPES.has(file.type)) return jsonError("Envie PNG, JPG, WEBP ou PDF.", 400, "INVALID_PAYMENT_PROOF_TYPE");
  if (file.size <= 0 || file.size > MAX_BYTES) return jsonError("O comprovante deve ter no máximo 8 MB.", 400, "PAYMENT_PROOF_TOO_LARGE");

  const bucket = await siteAssetsBucket();
  if (!bucket) return jsonError("O armazenamento de comprovantes ainda não foi configurado.", 503, "SITE_ASSETS_NOT_CONFIGURED");

  const extension = extensionFor(file.type);
  const key = `tenants/${appointment.tenant_id}/payment-proofs/${appointment.id}/${crypto.randomUUID()}.${extension}`;
  await bucket.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: {
      tenantId: appointment.tenant_id,
      appointmentId: appointment.id,
      kind: "payment-proof",
      originalName: file.name.slice(0, 180),
    },
  });

  await d1.batch([
    d1.prepare(`
      UPDATE appointments
      SET payment_proof_key = ?, payment_status = 'proof_sent', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `).bind(key, appointment.id, appointment.tenant_id),
    d1.prepare(`
      INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json)
      VALUES (?, ?, 'public', 'appointment.payment.proof_uploaded', 'appointment', ?, ?)
    `).bind(
      crypto.randomUUID(),
      appointment.tenant_id,
      appointment.id,
      JSON.stringify({ source: "customer", contentType: file.type, size: file.size }),
    ),
  ]);

  return Response.json({ paymentStatus: "proof_sent", proofAttached: true }, { status: 201 });
}

function extensionFor(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "application/pdf") return "pdf";
  return "jpg";
}
