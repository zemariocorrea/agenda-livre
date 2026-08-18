import { listAvailableSlotsForService } from "@/lib/availability";
import { getD1 } from "@/lib/d1";
import { cleanText, jsonError } from "@/lib/http";
import { addDaysToLocalDate, dateKeyInTimeZone } from "@/lib/timezone";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const slug = cleanText(params.get("tenant"), 100) || "clinica-aurora";
  const serviceId = cleanText(params.get("serviceId"), 100);
  const professionalId = cleanText(params.get("professionalId"), 100) || undefined;
  const date = cleanText(params.get("date"), 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !serviceId) return jsonError("Informe uma data e um serviço válidos.");

  const d1 = await getD1();
  const tenant = await d1.prepare(
    "SELECT id, timezone FROM tenants WHERE slug = ? AND is_active = 1 LIMIT 1",
  ).bind(slug).first<{ id: string; timezone: string }>();
  if (!tenant) return jsonError("Empresa não encontrada.", 404, "TENANT_NOT_FOUND");

  const today = dateKeyInTimeZone(new Date(), tenant.timezone);
  if (date < today || date > addDaysToLocalDate(today, 180)) {
    return jsonError("Escolha uma data entre hoje e os próximos 180 dias.", 400, "DATE_OUT_OF_RANGE");
  }

  const service = await d1.prepare(
    "SELECT id FROM services WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1",
  ).bind(serviceId, tenant.id).first<{ id: string }>();
  if (!service) return jsonError("Serviço não encontrado.", 404, "SERVICE_NOT_FOUND");

  let availability;
  try {
    availability = await listAvailableSlotsForService(d1, {
      tenantId: tenant.id,
      serviceId: service.id,
      professionalId,
      timezone: tenant.timezone,
      localDate: date,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("GOOGLE_AVAILABILITY_UNAVAILABLE")) {
      return jsonError("Não foi possível validar a agenda externa agora. Tente novamente em instantes.", 503, "GOOGLE_AVAILABILITY_UNAVAILABLE");
    }
    throw error;
  }

  if (professionalId && !availability.professionals.length) {
    return jsonError("Profissional não atende esta atividade.", 404, "PROFESSIONAL_SERVICE_NOT_FOUND");
  }

  return Response.json({
    date,
    professionalId: professionalId ?? null,
    timezone: tenant.timezone,
    professionals: availability.professionals,
    slots: availability.slots,
  });
}
