import { requireTenantPage } from "@/lib/auth/access";
import { cleanText } from "@/lib/http";
import { AdminDashboard } from "../../components/admin-dashboard";

export const dynamic = "force-dynamic";

type AdminTenantPageProps = {
  params: Promise<{
    tenant: string;
  }>;
};

export default async function AdminTenantPage({
  params,
}: AdminTenantPageProps) {
  const resolvedParams = await params;

  const tenantSlug = cleanText(resolvedParams.tenant, 100);

  await requireTenantPage(
    tenantSlug,
    `/admin/${encodeURIComponent(tenantSlug)}`
  );

  return <AdminDashboard tenantSlug={tenantSlug} />;
}