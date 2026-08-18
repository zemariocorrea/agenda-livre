import { rejectCrossSiteMutation } from "@/lib/auth/request";
import { destroyCurrentSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  await destroyCurrentSession();
  return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
