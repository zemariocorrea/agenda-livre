import { requireTenantPage } from "@/lib/auth/access";
import { AdminDashboard } from "../components/admin-dashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage({ searchParams }: { searchParams?: Promise<{ tenant?: string }> }) {
  const tenantSlug = (await searchParams)?.tenant ?? "clinica-aurora";
  await requireTenantPage(tenantSlug, `/admin?tenant=${encodeURIComponent(tenantSlug)}`);
  return <AdminDashboard tenantSlug={tenantSlug} />;
}
