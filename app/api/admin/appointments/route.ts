import { adminTenant } from "@/lib/admin-auth";
import { getD1 } from "@/lib/d1";
import { cleanText } from "@/lib/http";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const access = await adminTenant(url.searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const d1 = await getD1();
  const professionalId = cleanText(url.searchParams.get("professionalId"), 100);
  const status = cleanText(url.searchParams.get("status"), 30);
  const rows = await d1.prepare(`
    SELECT appointment.id, appointment.customer_name, appointment.customer_email, appointment.customer_phone,
           appointment.starts_at_utc, appointment.ends_at_utc, appointment.status, appointment.payment_status,
           appointment.payment_method, appointment.payment_amount_cents,
           CASE WHEN appointment.payment_proof_key IS NULL OR appointment.payment_proof_key = '' THEN 0 ELSE 1 END AS payment_proof_available,
           appointment.price_cents, appointment.public_token,
           service.name AS service_name, professional.id AS professional_id, professional.name AS professional_name,
           professional.color AS professional_color
    FROM appointments AS appointment
    INNER JOIN services AS service ON service.id = appointment.service_id AND service.tenant_id = appointment.tenant_id
    INNER JOIN professionals AS professional ON professional.id = appointment.professional_id AND professional.tenant_id = appointment.tenant_id
    WHERE appointment.tenant_id = ?
      AND (? = '' OR appointment.professional_id = ?)
      AND (? = '' OR appointment.status = ?)
    ORDER BY appointment.starts_at_utc DESC
    LIMIT 200
  `).bind(access.tenant.id, professionalId, professionalId, status, status).all();
  return Response.json({ appointments: rows.results });
}
