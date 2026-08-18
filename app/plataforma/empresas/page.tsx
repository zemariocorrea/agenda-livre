import { requirePlatformAdminPage } from "@/lib/auth/access";
import { PlatformDashboard } from "../../components/platform-dashboard";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  await requirePlatformAdminPage("/plataforma/empresas");
  return <PlatformDashboard initialView="companies" />;
}
