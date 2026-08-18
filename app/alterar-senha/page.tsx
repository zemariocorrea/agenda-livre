import { requirePageUser } from "@/lib/auth/access";
import { ChangePasswordForm } from "../components/change-password-form";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage({ searchParams }: { searchParams?: Promise<{ return_to?: string }> }) {
  const params = await searchParams;
  await requirePageUser("/alterar-senha", true);
  return <ChangePasswordForm returnTo={params?.return_to ?? ""} />;
}
