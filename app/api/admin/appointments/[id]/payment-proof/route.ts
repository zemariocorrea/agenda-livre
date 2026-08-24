import { adminTenant, requireTenantManager } from "@/lib/admin-auth";
import { getD1 } from "@/lib/d1";
import { jsonError } from "@/lib/http";
import { siteAssetsBucket } from "@/lib/r2-storage";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const forbidden = requireTenantManager(access.member.role);
  if (forbidden) return forbidden;

  const { id } = await context.params;
  const d1 = await getD1();
  const appointment = await d1.prepare(`
    SELECT payment_proof_key
    FROM appointments
    WHERE id = ? AND tenant_id = ?
    LIMIT 1
  `).bind(id, access.tenant.id).first<{ payment_proof_key: string | null }>();

  if (!appointment?.payment_proof_key) return jsonError("Comprovante não encontrado.", 404, "PAYMENT_PROOF_NOT_FOUND");
  const prefix = `tenants/${access.tenant.id}/payment-proofs/${id}/`;
  if (!appointment.payment_proof_key.startsWith(prefix)) return jsonError("Comprovante inválido.", 404, "PAYMENT_PROOF_NOT_FOUND");

  const bucket = await siteAssetsBucket();
  if (!bucket) return jsonError("Armazenamento de comprovantes indisponível.", 503, "SITE_ASSETS_NOT_CONFIGURED");
  const object = await bucket.get(appointment.payment_proof_key);
  if (!object) return jsonError("Comprovante não encontrado.", 404, "PAYMENT_PROOF_NOT_FOUND");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "private, no-store");
  headers.set("content-disposition", "inline");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}
