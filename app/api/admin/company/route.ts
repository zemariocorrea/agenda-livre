import { adminTenant, requireTenantManager } from "@/lib/admin-auth";
import { getD1 } from "@/lib/d1";
import { cleanText, isEmail, jsonError, normalizeEmail } from "@/lib/http";
import { rejectCrossSiteMutation } from "@/lib/auth/request";

export async function GET(request: Request) {
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const d1 = await getD1();
  const company = await d1.prepare("SELECT id, slug, name, subtitle, timezone, currency, location, contact_email, plan, max_professionals, brand_color, hero_title, hero_description, custom_domain, is_active FROM tenants WHERE id = ? LIMIT 1")
    .bind(access.tenant.id).first();
  return Response.json({ company, canManage: !requireTenantManager(access.member.role) });
}

export async function PATCH(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const forbidden = requireTenantManager(access.member.role);
  if (forbidden) return forbidden;
  const d1 = await getD1();
  const payload = await request.json() as Record<string, unknown>;
  const current = await d1.prepare("SELECT * FROM tenants WHERE id = ? LIMIT 1").bind(access.tenant.id).first<Record<string, unknown>>();
  if (!current) return jsonError("Empresa não encontrada.", 404, "TENANT_NOT_FOUND");
  const name = cleanText(payload.name ?? current.name, 120);
  const contactEmail = normalizeEmail(payload.contactEmail ?? current.contact_email);
  if (!name || (contactEmail && !isEmail(contactEmail))) return jsonError("Informe nome e e-mail válidos.");
  await d1.batch([
    d1.prepare("UPDATE tenants SET name = ?, subtitle = ?, location = ?, timezone = ?, contact_email = ?, brand_color = ?, hero_title = ?, hero_description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(name, cleanText(payload.subtitle ?? current.subtitle, 160), cleanText(payload.location ?? current.location, 160), cleanText(payload.timezone ?? current.timezone, 80), contactEmail, cleanText(payload.brandColor ?? current.brand_color, 20) || "#17624f", cleanText(payload.heroTitle ?? current.hero_title, 220), cleanText(payload.heroDescription ?? current.hero_description, 500), access.tenant.id),
    d1.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, 'tenant.settings.updated', 'tenant', ?, ?)")
      .bind(crypto.randomUUID(), access.tenant.id, access.user.email, access.tenant.id, JSON.stringify({ name, contactEmail })),
  ]);
  return Response.json({ saved: true });
}
