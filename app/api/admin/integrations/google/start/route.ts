import { adminTenant, requireTenantManager } from "@/lib/admin-auth";
import { sha256 } from "@/lib/crypto-secrets";
import { getD1 } from "@/lib/d1";
import { cleanText, jsonError } from "@/lib/http";
import { googleRedirectUri } from "@/lib/integrations/google-calendar";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
];

export async function GET(request: Request) {
  const d1 = await getD1();
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const url = new URL(request.url);
  const tenantSlug = cleanText(url.searchParams.get("tenant"), 100);
  if (!tenantSlug) return jsonError("Informe a empresa que conectará o Google Agenda.", 400, "TENANT_REQUIRED");
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
    return jsonError("A integração global com Google ainda não foi configurada.", 503, "GOOGLE_NOT_CONFIGURED");
  }

  const access = await adminTenant(tenantSlug);
  if ("error" in access) return access.error;
  const managerError = requireTenantManager(access.member.role);
  if (managerError) return managerError;

  const professionalId = cleanText(url.searchParams.get("professionalId"), 100) || null;
  if (professionalId) {
    const professional = await d1.prepare(
      "SELECT id FROM professionals WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1",
    ).bind(professionalId, access.tenant.id).first<{ id: string }>();
    if (!professional) return jsonError("Profissional não encontrado nesta empresa.", 404, "PROFESSIONAL_NOT_FOUND");
  }

  const state = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const redirectUri = googleRedirectUri(request.url);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await d1.prepare("DELETE FROM oauth_states WHERE datetime(expires_at) <= CURRENT_TIMESTAMP OR consumed_at IS NOT NULL").run();
  await d1.prepare(`
    INSERT INTO oauth_states (
      id, tenant_id, professional_id, provider, state_hash, redirect_uri, expires_at
    ) VALUES (?, ?, ?, 'google_calendar', ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    access.tenant.id,
    professionalId,
    await sha256(state),
    redirectUri,
    expiresAt,
  ).run();

  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: GOOGLE_SCOPES.join(" "),
    state,
  }).toString();

  return Response.redirect(authorization);
}
