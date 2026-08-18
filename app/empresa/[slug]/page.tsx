import { PublicBookingPage } from "../../components/public-booking-page";

export const dynamic = "force-dynamic";

export default async function TenantSitePage({ params }: { params: Promise<{ slug: string }> }) {
  return <PublicBookingPage tenantSlug={(await params).slug} />;
}
