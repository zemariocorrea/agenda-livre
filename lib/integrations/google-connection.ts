import { decryptSecret } from "../crypto-secrets";
import type { GoogleCredentials } from "./google-calendar";

export type GoogleConnectionRow = {
  id: string;
  tenant_id: string;
  professional_id: string | null;
  status: string;
  external_account_id: string | null;
  encrypted_credentials: string | null;
  configuration_json: string;
  last_synced_at: string | null;
};

export async function resolveGoogleConnection(
  d1: D1Database,
  input: { tenantId: string; professionalId?: string | null; allowTenantFallback?: boolean },
): Promise<GoogleConnectionRow | null> {
  if (input.professionalId) {
    const row = await d1.prepare(`
      SELECT id, tenant_id, professional_id, status, external_account_id,
             encrypted_credentials, configuration_json, last_synced_at
      FROM integration_connections
      WHERE tenant_id = ? AND provider = 'google_calendar' AND status = 'connected'
        AND (professional_id = ? OR professional_id IS NULL)
      ORDER BY CASE WHEN professional_id = ? THEN 0 ELSE 1 END
      LIMIT 1
    `).bind(input.tenantId, input.professionalId, input.professionalId).first<GoogleConnectionRow>();
    if (row && (row.professional_id || input.allowTenantFallback !== false)) return row;
    return row?.professional_id ? row : null;
  }

  return d1.prepare(`
    SELECT id, tenant_id, professional_id, status, external_account_id,
           encrypted_credentials, configuration_json, last_synced_at
    FROM integration_connections
    WHERE tenant_id = ? AND provider = 'google_calendar' AND status = 'connected'
      AND professional_id IS NULL
    LIMIT 1
  `).bind(input.tenantId).first<GoogleConnectionRow>();
}

export async function googleCredentialsFromConnection(connection: GoogleConnectionRow) {
  if (!connection.encrypted_credentials) return null;
  return decryptSecret<GoogleCredentials>(connection.encrypted_credentials);
}

export function googleConnectionConfiguration(connection: GoogleConnectionRow) {
  try {
    return JSON.parse(connection.configuration_json || "{}") as {
      calendarId?: string;
      calendarSummary?: string;
      scope?: string;
      connectedAt?: string;
    };
  } catch {
    return {};
  }
}
