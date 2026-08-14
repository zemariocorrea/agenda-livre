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
  const [today, upcoming, revenue, recent, notifications, integrations] = await d1.batch([
    d1.prepare("SELECT COUNT(*) AS total FROM appointments WHERE tenant_id = ? AND starts_at_utc >= ? AND starts_at_utc < ? AND status IN ('pending', 'confirmed')").bind(tenantId, todayStart, tomorrowStart),
    d1.prepare("SELECT COUNT(*) AS total FROM appointments WHERE tenant_id = ? AND starts_at_utc >= CURRENT_TIMESTAMP AND status IN ('pending', 'confirmed')").bind(tenantId),
    d1.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM payments WHERE tenant_id = ? AND status = 'paid' AND paid_at >= ? AND paid_at < ?").bind(tenantId, monthStart, nextMonthStart),
    d1.prepare("SELECT a.id, a.customer_name, a.customer_email, a.starts_at_utc, a.status, a.payment_status, s.name AS service_name, s.duration_minutes FROM appointments a JOIN services s ON s.id = a.service_id WHERE a.tenant_id = ? AND a.starts_at_utc >= datetime('now', '-1 day') ORDER BY a.starts_at_utc LIMIT 12").bind(tenantId),
    d1.prepare("SELECT COUNT(*) AS total FROM notification_deliveries WHERE tenant_id = ? AND status = 'pending'").bind(tenantId),
    d1.prepare("SELECT provider, status, last_synced_at FROM integration_connections WHERE tenant_id = ? ORDER BY provider").bind(tenantId),
  ]);
  return Response.json({
    tenant: { slug: access.tenant.slug, name: access.tenant.name, timezone: access.tenant.timezone },
    user: { name: access.user.displayName, email: access.user.email, role: access.member.role },
    metrics: { today: Number(today.results[0]?.total ?? 0), upcoming: Number(upcoming.results[0]?.total ?? 0), revenueCents: Number(revenue.results[0]?.cents ?? 0), pendingNotifications: Number(notifications.results[0]?.total ?? 0) },
    appointments: recent.results,
    integrations: integrations.results,
  });
}
