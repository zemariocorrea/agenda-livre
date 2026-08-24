import { adminTenant } from "@/lib/admin-auth";
import { getD1 } from "@/lib/d1";
import { addDaysToLocalDate, dateKeyInTimeZone, parseLocalDateTime, partsInZone } from "@/lib/timezone";

export async function GET(request: Request) {
  const d1 = await getD1();
  const slug = new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora";
  const access = await adminTenant(slug);
  if ("error" in access) return access.error;
  const tenantId = access.tenant.id;
  const now = new Date();
  const todayKey = dateKeyInTimeZone(now, access.tenant.timezone);
  const todayStart = parseLocalDateTime(todayKey, "00:00", access.tenant.timezone).toISOString();
  const tomorrowStart = parseLocalDateTime(addDaysToLocalDate(todayKey, 1), "00:00", access.tenant.timezone).toISOString();
  const local = partsInZone(now, access.tenant.timezone);
  const monthStartKey = `${String(local.year).padStart(4, "0")}-${String(local.month).padStart(2, "0")}-01`;
  const nextMonthKey = new Date(Date.UTC(local.year, local.month, 1, 12)).toISOString().slice(0, 10);
  const monthStart = parseLocalDateTime(monthStartKey, "00:00", access.tenant.timezone).toISOString();
  const nextMonthStart = parseLocalDateTime(nextMonthKey, "00:00", access.tenant.timezone).toISOString();
  const [today, upcoming, revenue, recent, notifications, integrations, professionals] = await d1.batch([
    d1.prepare("SELECT COUNT(*) AS total FROM appointments WHERE tenant_id = ? AND starts_at_utc >= ? AND starts_at_utc < ? AND status IN ('pending', 'confirmed')").bind(tenantId, todayStart, tomorrowStart),
    d1.prepare("SELECT COUNT(*) AS total FROM appointments WHERE tenant_id = ? AND starts_at_utc >= CURRENT_TIMESTAMP AND status IN ('pending', 'confirmed')").bind(tenantId),
    d1.prepare(`
      SELECT
        COALESCE((SELECT SUM(amount_cents) FROM payments WHERE tenant_id = ? AND status = 'paid' AND paid_at >= ? AND paid_at < ?), 0)
        + COALESCE((SELECT SUM(payment_amount_cents) FROM appointments WHERE tenant_id = ? AND payment_method IS NOT NULL AND payment_status = 'paid' AND payment_confirmed_at >= ? AND payment_confirmed_at < ?), 0)
        AS cents
    `).bind(tenantId, monthStart, nextMonthStart, tenantId, monthStart, nextMonthStart),
    d1.prepare("SELECT a.id, a.customer_name, a.customer_email, a.starts_at_utc, a.status, a.payment_status, a.payment_method, a.payment_amount_cents, CASE WHEN a.payment_proof_key IS NULL OR a.payment_proof_key = '' THEN 0 ELSE 1 END AS payment_proof_available, s.name AS service_name, COALESCE(a.duration_minutes, s.duration_minutes) AS duration_minutes, p.id AS professional_id, p.name AS professional_name, p.color AS professional_color FROM appointments a JOIN services s ON s.id = a.service_id JOIN professionals p ON p.id = a.professional_id AND p.tenant_id = a.tenant_id WHERE a.tenant_id = ? AND a.starts_at_utc >= datetime('now', '-1 day') ORDER BY a.starts_at_utc LIMIT 24").bind(tenantId),
    d1.prepare("SELECT COUNT(*) AS total FROM notification_deliveries WHERE tenant_id = ? AND status = 'pending'").bind(tenantId),
    d1.prepare("SELECT connection.provider, connection.status, connection.last_synced_at, connection.external_account_id, connection.configuration_json, professional.id AS professional_id, professional.name AS professional_name FROM integration_connections AS connection LEFT JOIN professionals AS professional ON professional.id = connection.professional_id AND professional.tenant_id = connection.tenant_id WHERE connection.tenant_id = ? ORDER BY connection.provider, CASE WHEN connection.professional_id IS NULL THEN 0 ELSE 1 END, professional.sort_order, professional.name").bind(tenantId),
    d1.prepare("SELECT COUNT(*) AS total FROM professionals WHERE tenant_id = ? AND is_active = 1").bind(tenantId),
  ]);
  return Response.json({
    tenant: { slug: access.tenant.slug, name: access.tenant.name, timezone: access.tenant.timezone, plan: access.tenant.plan, maxProfessionals: access.tenant.maxProfessionals },
    user: { name: access.user.displayName, email: access.user.email, role: access.member.role },
    metrics: { today: Number(today.results[0]?.total ?? 0), upcoming: Number(upcoming.results[0]?.total ?? 0), revenueCents: Number(revenue.results[0]?.cents ?? 0), pendingNotifications: Number(notifications.results[0]?.total ?? 0), professionals: Number(professionals.results[0]?.total ?? 0) },
    appointments: recent.results,
    integrations: integrations.results,
  });
}
