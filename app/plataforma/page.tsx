import { requirePlatformAdminPage } from "@/lib/auth/access";
import { PlatformDashboard } from "../components/platform-dashboard";

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  await requirePlatformAdminPage("/plataforma");
  return <PlatformDashboard initialView="overview" />;
}
