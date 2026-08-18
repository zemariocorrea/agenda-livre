import { PublicBookingPage } from "./components/public-booking-page";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams?: Promise<{ tenant?: string }> }) {
  return <PublicBookingPage tenantSlug={(await searchParams)?.tenant ?? "clinica-aurora"} />;
}
