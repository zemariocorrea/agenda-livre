import { adminTenant, requireTenantManager } from "@/lib/admin-auth";
import { decryptSecret, encryptSecret } from "@/lib/crypto-secrets";
import { getD1 } from "@/lib/d1";
import { cleanText, jsonError } from "@/lib/http";
import { rejectCrossSiteMutation } from "@/lib/auth/request";
import {
  listGoogleCalendars,
  revokeGoogleToken,
  type GoogleCredentials,
} from "@/lib/integrations/google-calendar";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantSlug = cleanText(url.searchParams.get("tenant"), 100);
  if (!tenantSlug) return jsonError("Informe a empresa.", 400, "TENANT_REQUIRED");
  const access = await adminTenant(tenantSlug);
  if ("error" in access) return access.error;
  const d1 = await getD1();
  const rows = await d1.prepare(`
    SELECT connection.id, connection.professional_id, connection.status,
           connection.external_account_id, connection.configuration_json,
           connection.last_synced_at, professional.name AS professional_name
    FROM integration_connections AS connection
    LEFT JOIN professionals AS professional
      ON professional.id = connection.professional_id AND professional.tenant_id = connection.tenant_id
    WHERE connection.tenant_id = ? AND connection.provider = 'google_calendar'
    ORDER BY CASE WHEN connection.professional_id IS NULL THEN 0 ELSE 1 END,
             professional.sort_order, professional.name
  `).bind(access.tenant.id).all();
  return Response.json({ configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), connections: rows.results });
}

export async function PATCH(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const url = new URL(request.url);
  const tenantSlug = cleanText(url.searchParams.get("tenant"), 100);
  if (!tenantSlug) return jsonError("Informe a empresa.", 400, "TENANT_REQUIRED");
  const access = await adminTenant(tenantSlug);
  if ("error" in access) return access.error;
  const managerError = requireTenantManager(access.member.role);
  if (managerError) return managerError;

  const payload = await request.json() as { professionalId?: string | null; calendarId?: string };
  const professionalId = cleanText(payload.professionalId, 100) || null;
  const calendarId = cleanText(payload.calendarId, 500);
  if (!calendarId) return jsonError("Selecione um calendário.", 400, "CALENDAR_REQUIRED");

  const d1 = await getD1();
  const connection = await exactConnection(d1, access.tenant.id, professionalId);
  if (!connection?.encrypted_credentials || connection.status !== "connected") {
    return jsonError("Conexão Google não encontrada.", 404, "GOOGLE_CONNECTION_NOT_FOUND");
  }
  const credentials = await decryptSecret<GoogleCredentials>(connection.encrypted_credentials);
  const calendars = await listGoogleCalendars(credentials.refreshToken);
  const selected = calendars.find((calendar) => calendar.id === calendarId);
  if (!selected) return jsonError("Esse calendário não está disponível para escrita nesta conta.", 400, "GOOGLE_CALENDAR_NOT_WRITABLE");

  const encrypted = await encryptSecret({ ...credentials, calendarId: selected.id });
  let current: Record<string, unknown> = {};
  try { current = JSON.parse(connection.configuration_json || "{}"); } catch { current = {}; }
  const configuration = JSON.stringify({ ...current, calendarId: selected.id, calendarSummary: selected.summary });
  await d1.prepare(`
    UPDATE integration_connections
    SET external_account_id = ?, encrypted_credentials = ?, configuration_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(selected.id, encrypted, configuration, connection.id).run();
  return Response.json({ connection: { id: connection.id, professionalId, calendarId: selected.id, calendarSummary: selected.summary } });
}

export async function DELETE(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const url = new URL(request.url);
  const tenantSlug = cleanText(url.searchParams.get("tenant"), 100);
  if (!tenantSlug) return jsonError("Informe a empresa.", 400, "TENANT_REQUIRED");
  const access = await adminTenant(tenantSlug);
  if ("error" in access) return access.error;
  const managerError = requireTenantManager(access.member.role);
  if (managerError) return managerError;

  const professionalId = cleanText(url.searchParams.get("professionalId"), 100) || null;
  const d1 = await getD1();
  const connection = await exactConnection(d1, access.tenant.id, professionalId);
  if (!connection) return Response.json({ disconnected: true });

  if (connection.encrypted_credentials) {
    try {
      const credentials = await decryptSecret<GoogleCredentials>(connection.encrypted_credentials);
      await revokeGoogleToken(credentials.refreshToken);
    } catch {
      // A desconexão local deve ocorrer mesmo se o Google já tiver revogado o token.
    }
  }
  await d1.prepare(`
    UPDATE integration_connections
    SET status = 'disconnected', encrypted_credentials = NULL, external_account_id = NULL,
        configuration_json = '{}', last_synced_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(connection.id).run();
  return Response.json({ disconnected: true });
}

async function exactConnection(d1: D1Database, tenantId: string, professionalId: string | null) {
  if (professionalId) {
    return d1.prepare(`
      SELECT id, status, encrypted_credentials, configuration_json
      FROM integration_connections
      WHERE tenant_id = ? AND provider = 'google_calendar' AND professional_id = ?
      LIMIT 1
    `).bind(tenantId, professionalId).first<{
      id: string; status: string; encrypted_credentials: string | null; configuration_json: string;
    }>();
  }
  return d1.prepare(`
    SELECT id, status, encrypted_credentials, configuration_json
    FROM integration_connections
    WHERE tenant_id = ? AND provider = 'google_calendar' AND professional_id IS NULL
    LIMIT 1
  `).bind(tenantId).first<{
    id: string; status: string; encrypted_credentials: string | null; configuration_json: string;
  }>();
}
