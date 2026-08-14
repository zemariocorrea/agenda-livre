import { AdminDashboard } from "../components/admin-dashboard";
import { requireChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function AdminPage({ searchParams }: { searchParams?: Promise<{ tenant?: string }> }) {
  const tenantSlug = (await searchParams)?.tenant ?? "clinica-aurora";
  return <ProtectedAdmin tenantSlug={tenantSlug} />;
}

async function ProtectedAdmin({ tenantSlug }: { tenantSlug: string }) {
  await requireChatGPTUser(`/admin?tenant=${encodeURIComponent(tenantSlug)}`);
  return <AdminDashboard tenantSlug={tenantSlug} />;
}
