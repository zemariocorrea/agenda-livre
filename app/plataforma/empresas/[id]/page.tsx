import { requirePlatformAdminPage } from "@/lib/auth/access";
import { PlatformTenantDetail } from "../../../components/platform-tenant-detail";

export const dynamic = "force-dynamic";

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePlatformAdminPage(`/plataforma/empresas/${encodeURIComponent(id)}`);
  return <PlatformTenantDetail tenantId={id} />;
}
