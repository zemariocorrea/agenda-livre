import { adminTenant } from "@/lib/admin-auth";
import { sha256 } from "@/lib/crypto-secrets";
import { getD1 } from "@/lib/d1";
import { jsonError } from "@/lib/http";

export async function GET(request: Request) {
  const d1 = await getD1();
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return jsonError("A integração com Google ainda não foi configurada.", 503, "GOOGLE_NOT_CONFIGURED");
  const url = new URL(request.url);
  const access = await adminTenant(url.searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;

  const state = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const redirectUri = `${url.origin}/api/admin/integrations/google/callback`;
  await d1.prepare("INSERT INTO oauth_states (id, tenant_id, provider, state_hash, redirect_uri, expires_at) VALUES (?, ?, 'google_calendar', ?, ?, ?)")
    .bind(crypto.randomUUID(), access.tenant.id, await sha256(state), redirectUri, new Date(Date.now() + 10 * 60_000).toISOString()).run();

  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: "https://www.googleapis.com/auth/calendar.events",
    state,
  }).toString();
  return Response.redirect(authorization);
}
