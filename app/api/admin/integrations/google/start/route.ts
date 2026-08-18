import { adminTenant } from "@/lib/admin-auth";
import { sha256 } from "@/lib/crypto-secrets";
import { getD1 } from "@/lib/d1";
import { cleanText, jsonError } from "@/lib/http";

export async function GET(request: Request) {
  const d1 = await getD1();
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return jsonError("A integração com Google ainda não foi configurada.", 503, "GOOGLE_NOT_CONFIGURED");
  const url = new URL(request.url);
  const access = await adminTenant(url.searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const professionalId = cleanText(url.searchParams.get("professionalId"), 100);
  if (!professionalId) return jsonError("Selecione o profissional que conectará a agenda.", 400, "PROFESSIONAL_REQUIRED");
  const professional = await d1.prepare("SELECT id FROM professionals WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1")
    .bind(professionalId, access.tenant.id).first<{ id: string }>();
  if (!professional) return jsonError("Profissional não encontrado nesta empresa.", 404, "PROFESSIONAL_NOT_FOUND");

  const state = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const redirectUri = `${url.origin}/api/admin/integrations/google/callback`;
  await d1.prepare("INSERT INTO oauth_states (id, tenant_id, professional_id, provider, state_hash, redirect_uri, expires_at) VALUES (?, ?, ?, 'google_calendar', ?, ?, ?)")
    .bind(crypto.randomUUID(), access.tenant.id, professional.id, await sha256(state), redirectUri, new Date(Date.now() + 10 * 60_000).toISOString()).run();

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
