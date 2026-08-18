import { encryptSecret, sha256 } from "@/lib/crypto-secrets";
import { getD1 } from "@/lib/d1";
import { jsonError } from "@/lib/http";
import { getCurrentUser } from "@/lib/auth/session";

export async function GET(request: Request) {
  const d1 = await getD1();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return jsonError("O Google não retornou uma autorização válida.", 400, "INVALID_OAUTH_CALLBACK");

  const stateHash = await sha256(state);
  const stored = await d1.prepare("SELECT id, tenant_id, professional_id, redirect_uri FROM oauth_states WHERE provider = 'google_calendar' AND state_hash = ? AND consumed_at IS NULL AND datetime(expires_at) > CURRENT_TIMESTAMP LIMIT 1")
    .bind(stateHash).first<{ id: string; tenant_id: string; professional_id: string | null; redirect_uri: string }>();
  if (!stored) return jsonError("Essa autorização expirou ou já foi utilizada.", 400, "INVALID_OAUTH_STATE");
  if (!stored.professional_id) return jsonError("O profissional da autorização não foi informado.", 400, "PROFESSIONAL_REQUIRED");

  const user = await getCurrentUser();
  if (!user) return jsonError("Entre na sua conta para concluir a integração.", 401, "UNAUTHENTICATED");
  const authorization = await d1.prepare(`
    SELECT 1 AS allowed
    WHERE EXISTS (
      SELECT 1 FROM tenant_members
      WHERE tenant_id = ? AND user_id = ? AND is_active = 1
    ) OR EXISTS (
      SELECT 1 FROM platform_admins
      WHERE user_id = ? AND is_active = 1
    )
    LIMIT 1
  `).bind(stored.tenant_id, user.id, user.id).first<{ allowed: number }>();
  if (!authorization) return jsonError("Seu usuário não pode alterar esta integração.", 403, "FORBIDDEN");
  const professional = await d1.prepare("SELECT id FROM professionals WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1")
    .bind(stored.professional_id, stored.tenant_id).first<{ id: string }>();
  if (!professional) return jsonError("O profissional não pertence mais a esta empresa.", 404, "PROFESSIONAL_NOT_FOUND");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return jsonError("A integração com Google ainda não foi configurada.", 503, "GOOGLE_NOT_CONFIGURED");
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: stored.redirect_uri, grant_type: "authorization_code" }),
  });
  const token = await tokenResponse.json() as { refresh_token?: string; scope?: string; error_description?: string };
  if (!tokenResponse.ok || !token.refresh_token) return jsonError(token.error_description ?? "O Google não retornou acesso offline. Tente conectar novamente.", 400, "GOOGLE_TOKEN_EXCHANGE_FAILED");

  const encrypted = await encryptSecret({ refreshToken: token.refresh_token, calendarId: "primary" });
  await d1.batch([
    d1.prepare("INSERT INTO integration_connections (id, tenant_id, professional_id, provider, status, encrypted_credentials, configuration_json) VALUES (?, ?, ?, 'google_calendar', 'connected', ?, ?) ON CONFLICT (tenant_id, provider, professional_id) DO UPDATE SET status = 'connected', encrypted_credentials = excluded.encrypted_credentials, configuration_json = excluded.configuration_json, updated_at = CURRENT_TIMESTAMP")
      .bind(crypto.randomUUID(), stored.tenant_id, professional.id, encrypted, JSON.stringify({ calendarId: "primary", scope: token.scope })),
    d1.prepare("UPDATE oauth_states SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?").bind(stored.id),
  ]);
  return Response.redirect(`${url.origin}/admin?integration=google-connected&professionalId=${encodeURIComponent(professional.id)}`);
}
