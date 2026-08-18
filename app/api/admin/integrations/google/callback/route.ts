import { adminTenant, requireTenantManager } from "@/lib/admin-auth";
import { decryptSecret, encryptSecret, sha256 } from "@/lib/crypto-secrets";
import { getD1 } from "@/lib/d1";
import { jsonError } from "@/lib/http";
import {
  exchangeGoogleAuthorizationCode,
  listGoogleCalendars,
  type GoogleCredentials,
} from "@/lib/integrations/google-calendar";

export async function GET(request: Request) {
  const d1 = await getD1();
  const url = new URL(request.url);
  const oauthError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (oauthError) return Response.redirect(`${url.origin}/acesso-negado?reason=google_oauth_${encodeURIComponent(oauthError)}`);
  if (!code || !state) return jsonError("O Google não retornou uma autorização válida.", 400, "INVALID_OAUTH_CALLBACK");

  const stateHash = await sha256(state);
  const stored = await d1.prepare(`
    SELECT oauth.id, oauth.tenant_id, oauth.professional_id, oauth.redirect_uri, tenant.slug
    FROM oauth_states AS oauth
    INNER JOIN tenants AS tenant ON tenant.id = oauth.tenant_id AND tenant.is_active = 1
    WHERE oauth.provider = 'google_calendar'
      AND oauth.state_hash = ?
      AND oauth.consumed_at IS NULL
      AND datetime(oauth.expires_at) > CURRENT_TIMESTAMP
    LIMIT 1
  `).bind(stateHash).first<{
    id: string;
    tenant_id: string;
    professional_id: string | null;
    redirect_uri: string;
    slug: string;
  }>();
  if (!stored) return jsonError("Essa autorização expirou ou já foi utilizada.", 400, "INVALID_OAUTH_STATE");

  const access = await adminTenant(stored.slug);
  if ("error" in access) return access.error;
  const managerError = requireTenantManager(access.member.role);
  if (managerError) return managerError;

  if (stored.professional_id) {
    const professional = await d1.prepare(
      "SELECT id FROM professionals WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1",
    ).bind(stored.professional_id, stored.tenant_id).first<{ id: string }>();
    if (!professional) return jsonError("O profissional não pertence mais a esta empresa.", 404, "PROFESSIONAL_NOT_FOUND");
  }

  let token;
  try {
    token = await exchangeGoogleAuthorizationCode({ code, redirectUri: stored.redirect_uri });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Não foi possível concluir a autorização do Google.", 400, "GOOGLE_TOKEN_EXCHANGE_FAILED");
  }

  const existing = await exactConnection(d1, stored.tenant_id, stored.professional_id);
  let refreshToken = token.refresh_token;
  if (!refreshToken && existing?.encrypted_credentials) {
    const previous = await decryptSecret<GoogleCredentials>(existing.encrypted_credentials);
    refreshToken = previous.refreshToken;
  }
  if (!refreshToken) {
    return jsonError("O Google não retornou acesso offline. Remova o acesso do aplicativo na sua conta Google e conecte novamente.", 400, "GOOGLE_REFRESH_TOKEN_MISSING");
  }

  let calendars;
  try {
    calendars = await listGoogleCalendars(refreshToken);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Não foi possível listar os calendários da conta Google.", 400, "GOOGLE_CALENDAR_LIST_FAILED");
  }
  const selected = calendars.find((calendar) => calendar.primary) ?? calendars[0];
  if (!selected) {
    return jsonError("Essa conta Google não possui um calendário com permissão de escrita.", 400, "GOOGLE_WRITABLE_CALENDAR_NOT_FOUND");
  }

  const encrypted = await encryptSecret({ refreshToken, calendarId: selected.id } satisfies GoogleCredentials);
  const configuration = JSON.stringify({
    calendarId: selected.id,
    calendarSummary: selected.summary,
    scope: token.scope ?? "",
    connectedAt: new Date().toISOString(),
  });

  if (existing) {
    await d1.prepare(`
      UPDATE integration_connections
      SET status = 'connected', external_account_id = ?, encrypted_credentials = ?,
          configuration_json = ?, last_synced_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(selected.id, encrypted, configuration, existing.id).run();
  } else {
    await d1.prepare(`
      INSERT INTO integration_connections (
        id, tenant_id, professional_id, provider, status, external_account_id,
        encrypted_credentials, configuration_json
      ) VALUES (?, ?, ?, 'google_calendar', 'connected', ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      stored.tenant_id,
      stored.professional_id,
      selected.id,
      encrypted,
      configuration,
    ).run();
  }

  await d1.prepare("UPDATE oauth_states SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?").bind(stored.id).run();
  const target = stored.professional_id ? `&professionalId=${encodeURIComponent(stored.professional_id)}` : "&scope=tenant";
  return Response.redirect(`${url.origin}/admin?tenant=${encodeURIComponent(stored.slug)}&integration=google-connected${target}`);
}

async function exactConnection(d1: D1Database, tenantId: string, professionalId: string | null) {
  if (professionalId) {
    return d1.prepare(`
      SELECT id, encrypted_credentials FROM integration_connections
      WHERE tenant_id = ? AND provider = 'google_calendar' AND professional_id = ?
      LIMIT 1
    `).bind(tenantId, professionalId).first<{ id: string; encrypted_credentials: string | null }>();
  }
  return d1.prepare(`
    SELECT id, encrypted_credentials FROM integration_connections
    WHERE tenant_id = ? AND provider = 'google_calendar' AND professional_id IS NULL
    LIMIT 1
  `).bind(tenantId).first<{ id: string; encrypted_credentials: string | null }>();
}
