import { adminTenant, requireTenantManager } from "@/lib/admin-auth";
import { rejectCrossSiteMutation } from "@/lib/auth/request";
import { getD1 } from "@/lib/d1";
import { cleanText, isEmail, jsonError, normalizeEmail } from "@/lib/http";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const forbidden = requireTenantManager(access.member.role);
  if (forbidden) return forbidden;

  const d1 = await getD1();
  const { id } = await context.params;
  const current = await d1.prepare("SELECT * FROM tenant_members WHERE id = ? AND tenant_id = ? LIMIT 1")
    .bind(id, access.tenant.id).first<Record<string, unknown>>();
  if (!current) return jsonError("Administrador não encontrado.", 404, "MEMBER_NOT_FOUND");

  const payload = await request.json() as Record<string, unknown>;
  const displayName = cleanText(payload.displayName ?? current.display_name, 120);
  const email = normalizeEmail(payload.email ?? current.email);
  const currentEmail = normalizeEmail(current.email);
  const requestedRole = String(payload.role ?? current.role);
  const role = current.role === "owner" ? "owner" : (["admin", "staff"].includes(requestedRole) ? requestedRole : String(current.role));
  const isActive = current.role === "owner" ? true : (typeof payload.isActive === "boolean" ? payload.isActive : Boolean(current.is_active));
  if (!displayName || !isEmail(email)) return jsonError("Informe nome e e-mail válidos.");
  if (current.user_id && email !== currentEmail) {
    return jsonError("O e-mail de uma conta vinculada não pode ser alterado aqui. Crie um novo acesso para outro e-mail.", 409, "MEMBER_EMAIL_IMMUTABLE");
  }

  try {
    await d1.batch([
      d1.prepare("UPDATE tenant_members SET display_name = ?, email = ?, role = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?")
        .bind(displayName, email, role, isActive ? 1 : 0, id, access.tenant.id),
      d1.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, 'member.updated', 'tenant_member', ?, ?)")
        .bind(crypto.randomUUID(), access.tenant.id, access.user.email, id, JSON.stringify({ email, displayName, role, isActive })),
    ]);
  } catch (error) {
    if ((error instanceof Error ? error.message : String(error)).includes("UNIQUE")) return jsonError("Esse e-mail já administra esta empresa.", 409, "MEMBER_EXISTS");
    throw error;
  }
  return Response.json({ member: { id, displayName, email, role, isActive } });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const forbidden = requireTenantManager(access.member.role);
  if (forbidden) return forbidden;

  const d1 = await getD1();
  const { id } = await context.params;
  const member = await d1.prepare("SELECT role FROM tenant_members WHERE id = ? AND tenant_id = ? LIMIT 1")
    .bind(id, access.tenant.id).first<{ role: string }>();
  if (!member) return jsonError("Administrador não encontrado.", 404, "MEMBER_NOT_FOUND");
  if (member.role === "owner") return jsonError("O proprietário não pode ser removido. Transfira a propriedade pelo Admin Master.", 409, "OWNER_PROTECTED");

  await d1.batch([
    d1.prepare("UPDATE tenant_members SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?").bind(id, access.tenant.id),
    d1.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, 'member.deactivated', 'tenant_member', ?, '{}')")
      .bind(crypto.randomUUID(), access.tenant.id, access.user.email, id),
  ]);
  return Response.json({ deactivated: true, id });
}
