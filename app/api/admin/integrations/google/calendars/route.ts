import { adminTenant, requireTenantManager } from "@/lib/admin-auth";
import { decryptSecret } from "@/lib/crypto-secrets";
import { getD1 } from "@/lib/d1";
import { cleanText, jsonError } from "@/lib/http";
import { listGoogleCalendars, type GoogleCredentials } from "@/lib/integrations/google-calendar";

export async function GET(request: Request) {
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
  if (!connection?.encrypted_credentials || connection.status !== "connected") {
    return jsonError("Conecte uma conta Google antes de escolher o calendário.", 404, "GOOGLE_CONNECTION_NOT_FOUND");
  }
  const credentials = await decryptSecret<GoogleCredentials>(connection.encrypted_credentials);
  const calendars = await listGoogleCalendars(credentials.refreshToken);
  return Response.json({ calendars, selectedCalendarId: credentials.calendarId ?? "primary" });
}

async function exactConnection(d1: D1Database, tenantId: string, professionalId: string | null) {
  const clause = professionalId ? "professional_id = ?" : "professional_id IS NULL";
  const statement = d1.prepare(`
    SELECT id, status, encrypted_credentials FROM integration_connections
    WHERE tenant_id = ? AND provider = 'google_calendar' AND ${clause}
    LIMIT 1
  `);
  return professionalId
    ? statement.bind(tenantId, professionalId).first<{ id: string; status: string; encrypted_credentials: string | null }>()
    : statement.bind(tenantId).first<{ id: string; status: string; encrypted_credentials: string | null }>();
}
