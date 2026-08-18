import { platformAdmin } from "@/lib/admin-auth";
import { getD1 } from "@/lib/d1";

export async function GET() {
  const access = await platformAdmin();
  if ("error" in access) return access.error;
  const d1 = await getD1();
  const [tenants, activeTenants, professionals, appointments, revenue, recent] = await d1.batch([
    d1.prepare("SELECT COUNT(*) AS total FROM tenants"),
    d1.prepare("SELECT COUNT(*) AS total FROM tenants WHERE is_active = 1"),
    d1.prepare("SELECT COUNT(*) AS total FROM professionals WHERE is_active = 1"),
    d1.prepare("SELECT COUNT(*) AS total FROM appointments WHERE status IN ('pending', 'confirmed')"),
    d1.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM payments WHERE status = 'paid'"),
    d1.prepare(`
      SELECT tenant.id, tenant.slug, tenant.name, tenant.plan, tenant.is_active, tenant.contact_email,
             tenant.created_at,
             (SELECT COUNT(*) FROM professionals WHERE tenant_id = tenant.id AND is_active = 1) AS professionals,
             (SELECT COUNT(*) FROM appointments WHERE tenant_id = tenant.id) AS appointments
      FROM tenants AS tenant
      ORDER BY tenant.created_at DESC, tenant.name
      LIMIT 8
    `),
  ]);
  return Response.json({
    user: { name: access.user.displayName, email: access.user.email },
    metrics: {
      tenants: Number(tenants.results[0]?.total ?? 0),
      activeTenants: Number(activeTenants.results[0]?.total ?? 0),
      professionals: Number(professionals.results[0]?.total ?? 0),
      appointments: Number(appointments.results[0]?.total ?? 0),
      revenueCents: Number(revenue.results[0]?.cents ?? 0),
    },
    recentTenants: recent.results,
  });
}
