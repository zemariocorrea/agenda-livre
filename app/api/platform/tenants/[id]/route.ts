import { platformAdmin } from "@/lib/admin-auth";
import { getD1 } from "@/lib/d1";
import { cleanText, isEmail, jsonError, normalizeEmail, normalizeSlug } from "@/lib/http";
import { rejectCrossSiteMutation } from "@/lib/auth/request";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await platformAdmin();
  if ("error" in access) return access.error;
  const d1 = await getD1();
  const { id } = await context.params;
  const [tenant, members, metrics] = await d1.batch([
    d1.prepare("SELECT * FROM tenants WHERE id = ? LIMIT 1").bind(id),
    d1.prepare("SELECT id, email, display_name, role, is_active, created_at FROM tenant_members WHERE tenant_id = ? ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, display_name").bind(id),
    d1.prepare(`SELECT
      (SELECT COUNT(*) FROM professionals WHERE tenant_id = ?) AS professionals,
      (SELECT COUNT(*) FROM services WHERE tenant_id = ?) AS services,
      (SELECT COUNT(*) FROM appointments WHERE tenant_id = ?) AS appointments,
      (SELECT COUNT(*) FROM outbox_events WHERE tenant_id = ? AND status IN ('pending', 'failed')) AS pending_events
    `).bind(id, id, id, id),
  ]);
  if (!tenant.results[0]) return jsonError("Empresa não encontrada.", 404, "TENANT_NOT_FOUND");
  return Response.json({ tenant: tenant.results[0], members: members.results, metrics: metrics.results[0] });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const access = await platformAdmin();
  if ("error" in access) return access.error;
  const d1 = await getD1();
  const { id } = await context.params;
  const current = await d1.prepare("SELECT * FROM tenants WHERE id = ? LIMIT 1").bind(id).first<Record<string, unknown>>();
  if (!current) return jsonError("Empresa não encontrada.", 404, "TENANT_NOT_FOUND");
  const payload = await request.json() as Record<string, unknown>;
  const name = cleanText(payload.name ?? current.name, 120);
  const slug = normalizeSlug(payload.slug ?? current.slug);
  const contactEmail = normalizeEmail(payload.contactEmail ?? current.contact_email);
  const timezone = cleanText(payload.timezone ?? current.timezone, 80);
  const plan = ["trial", "essential", "professional"].includes(String(payload.plan)) ? String(payload.plan) : String(current.plan);
  const maxProfessionals = Number(payload.maxProfessionals ?? current.max_professionals);
  const active = typeof payload.isActive === "boolean" ? payload.isActive : Boolean(current.is_active);
  if (!name || slug.length < 3 || (contactEmail && !isEmail(contactEmail)) || !Number.isInteger(maxProfessionals) || maxProfessionals < 1 || maxProfessionals > 500) {
    return jsonError("Revise os dados da empresa.");
  }
  try {
    await d1.batch([
      d1.prepare(`UPDATE tenants SET slug = ?, name = ?, subtitle = ?, timezone = ?, location = ?, contact_email = ?, plan = ?, max_professionals = ?, brand_color = ?, hero_title = ?, hero_description = ?, custom_domain = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(slug, name, cleanText(payload.subtitle ?? current.subtitle, 160), timezone, cleanText(payload.location ?? current.location, 160), contactEmail, plan, maxProfessionals, cleanText(payload.brandColor ?? current.brand_color, 20) || "#17624f", cleanText(payload.heroTitle ?? current.hero_title, 220), cleanText(payload.heroDescription ?? current.hero_description, 500), cleanText(payload.customDomain ?? current.custom_domain, 200) || null, active ? 1 : 0, id),
      d1.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, 'tenant.updated', 'tenant', ?, ?)")
        .bind(crypto.randomUUID(), id, access.user.email, id, JSON.stringify({ name, slug, plan, active })),
    ]);
  } catch (error) {
    if ((error instanceof Error ? error.message : String(error)).includes("UNIQUE")) return jsonError("Esse endereço público já está em uso.", 409, "TENANT_SLUG_EXISTS");
    throw error;
  }
  return Response.json({ tenant: { id, slug, name, plan, maxProfessionals, isActive: active } });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const crossSite = rejectCrossSiteMutation(_request);
  if (crossSite) return crossSite;
  const access = await platformAdmin();
  if ("error" in access) return access.error;
  const d1 = await getD1();
  const { id } = await context.params;
  const result = await d1.prepare("UPDATE tenants SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND is_active = 1").bind(id).run();
  if (!result.meta.changes) return jsonError("Empresa não encontrada ou já arquivada.", 404, "TENANT_NOT_FOUND");
  await d1.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, 'tenant.archived', 'tenant', ?, '{}')")
    .bind(crypto.randomUUID(), id, access.user.email, id).run();
  return Response.json({ archived: true, id });
}
