import { adminTenant } from "@/lib/admin-auth";
import { getD1 } from "@/lib/d1";
import { cleanText, jsonError } from "@/lib/http";
import { rejectCrossSiteMutation } from "@/lib/auth/request";

type Rule = { weekday?: number; startTime?: string; endTime?: string; slotIntervalMinutes?: number; isActive?: boolean };

export async function GET(request: Request) {
  const d1 = await getD1();
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const rows = await d1.prepare("SELECT id, professional_id, weekday, start_time, end_time, slot_interval_minutes, is_active FROM availability_rules WHERE tenant_id = ? ORDER BY professional_id, weekday, start_time").bind(access.tenant.id).all();
  return Response.json({ rules: rows.results });
}

export async function PUT(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const d1 = await getD1();
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const payload = await request.json() as { professionalId?: string; rules?: Rule[] };
  const professionalId = cleanText(payload.professionalId, 100);
  if (!Array.isArray(payload.rules) || payload.rules.length > 28) return jsonError("Envie uma lista válida de disponibilidades.");
  if (!professionalId) return jsonError("Selecione o profissional da agenda.", 400, "PROFESSIONAL_REQUIRED");
  const professional = await d1.prepare("SELECT id FROM professionals WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1")
    .bind(professionalId, access.tenant.id).first<{ id: string }>();
  if (!professional) return jsonError("Profissional não encontrado nesta empresa.", 404, "PROFESSIONAL_NOT_FOUND");
  const statements = [d1.prepare("DELETE FROM availability_rules WHERE tenant_id = ? AND professional_id = ?").bind(access.tenant.id, professional.id)];
  for (const rule of payload.rules) {
    const weekday = Number(rule.weekday);
    const startTime = cleanText(rule.startTime, 5);
    const endTime = cleanText(rule.endTime, 5);
    const interval = Number(rule.slotIntervalMinutes ?? 30);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) || startTime >= endTime || ![5, 10, 15, 20, 30, 60].includes(interval)) return jsonError("Uma das faixas de horário é inválida.");
    statements.push(d1.prepare("INSERT INTO availability_rules (id, tenant_id, professional_id, weekday, start_time, end_time, slot_interval_minutes, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), access.tenant.id, professional.id, weekday, startTime, endTime, interval, rule.isActive === false ? 0 : 1));
  }
  statements.push(d1.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, 'availability.updated', 'professional', ?, ?)")
    .bind(crypto.randomUUID(), access.tenant.id, access.user.email, professional.id, JSON.stringify({ professionalId: professional.id, ruleCount: payload.rules.length })));
  await d1.batch(statements);
  return Response.json({ saved: true, professionalId: professional.id, count: payload.rules.length });
}
