import { adminTenant } from "@/lib/admin-auth";
import { getD1 } from "@/lib/d1";
import { cleanText, jsonError } from "@/lib/http";

type Rule = { weekday?: number; startTime?: string; endTime?: string; slotIntervalMinutes?: number; isActive?: boolean };

export async function GET(request: Request) {
  const d1 = await getD1();
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const rows = await d1.prepare("SELECT id, member_id, weekday, start_time, end_time, slot_interval_minutes, is_active FROM availability_rules WHERE tenant_id = ? ORDER BY weekday, start_time").bind(access.tenant.id).all();
  return Response.json({ rules: rows.results });
}

export async function PUT(request: Request) {
  const d1 = await getD1();
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const payload = await request.json() as { rules?: Rule[] };
  if (!Array.isArray(payload.rules) || payload.rules.length > 28) return jsonError("Envie uma lista válida de disponibilidades.");
  const member = await d1.prepare("SELECT id FROM tenant_members WHERE tenant_id = ? AND is_active = 1 ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END LIMIT 1").bind(access.tenant.id).first<{ id: string }>();
  if (!member) return jsonError("Nenhum responsável ativo foi encontrado.", 409, "NO_ACTIVE_MEMBER");
  const statements = [d1.prepare("DELETE FROM availability_rules WHERE tenant_id = ? AND member_id = ?").bind(access.tenant.id, member.id)];
  for (const rule of payload.rules) {
    const weekday = Number(rule.weekday);
    const startTime = cleanText(rule.startTime, 5);
    const endTime = cleanText(rule.endTime, 5);
    const interval = Number(rule.slotIntervalMinutes ?? 30);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) || startTime >= endTime || ![5, 10, 15, 20, 30, 60].includes(interval)) return jsonError("Uma das faixas de horário é inválida.");
    statements.push(d1.prepare("INSERT INTO availability_rules (id, tenant_id, member_id, weekday, start_time, end_time, slot_interval_minutes, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), access.tenant.id, member.id, weekday, startTime, endTime, interval, rule.isActive === false ? 0 : 1));
  }
  statements.push(d1.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, 'availability.updated', 'tenant', ?, ?)")
    .bind(crypto.randomUUID(), access.tenant.id, access.user.email, access.tenant.id, JSON.stringify({ ruleCount: payload.rules.length })));
  await d1.batch(statements);
  return Response.json({ saved: true, count: payload.rules.length });
}
