import { adminTenant, requireTenantManager } from "@/lib/admin-auth";
import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import { rejectCrossSiteMutation } from "@/lib/auth/request";
import { getD1 } from "@/lib/d1";
import { cleanText, isEmail, jsonError, normalizeEmail } from "@/lib/http";

export async function GET(request: Request) {
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const d1 = await getD1();
  const rows = await d1.prepare(`
    SELECT id, user_id, email, display_name, role, is_active, created_at,
           CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END AS has_account
    FROM tenant_members
    WHERE tenant_id = ?
    ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, display_name
  `).bind(access.tenant.id).all();
  return Response.json({ members: rows.results, canManage: !requireTenantManager(access.member.role) });
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const forbidden = requireTenantManager(access.member.role);
  if (forbidden) return forbidden;

  const d1 = await getD1();
  const payload = await request.json() as Record<string, unknown>;
  const displayName = cleanText(payload.displayName, 120);
  const email = normalizeEmail(payload.email);
  const role = ["admin", "staff"].includes(String(payload.role)) ? String(payload.role) : "staff";
  if (!displayName || !isEmail(email)) return jsonError("Informe nome e e-mail válidos.");

  const existingUser = await d1.prepare("SELECT id, is_active FROM users WHERE email = ? LIMIT 1")
    .bind(email).first<{ id: string; is_active: number }>();
  if (existingUser && !existingUser.is_active) return jsonError("Esse e-mail pertence a uma conta desativada.", 409, "USER_INACTIVE");

  const memberId = crypto.randomUUID();
  const userId = existingUser?.id ?? crypto.randomUUID();
  const temporaryPassword = existingUser ? null : generateTemporaryPassword();
  const passwordHash = temporaryPassword ? await hashPassword(temporaryPassword) : null;
  const statements: D1PreparedStatement[] = [];

  if (passwordHash) {
    statements.push(d1.prepare(`
      INSERT INTO users (id, email, display_name, password_hash, must_change_password)
      VALUES (?, ?, ?, ?, 1)
    `).bind(userId, email, displayName, passwordHash));
  }

  statements.push(
    d1.prepare("INSERT INTO tenant_members (id, tenant_id, user_id, email, display_name, role) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(memberId, access.tenant.id, userId, email, displayName, role),
    d1.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, 'member.created', 'tenant_member', ?, ?)")
      .bind(crypto.randomUUID(), access.tenant.id, access.user.email, memberId, JSON.stringify({ email, displayName, role, accountCreated: Boolean(temporaryPassword) })),
  );

  try {
    await d1.batch(statements);
  } catch (error) {
    if ((error instanceof Error ? error.message : String(error)).includes("UNIQUE")) return jsonError("Esse e-mail já administra esta empresa.", 409, "MEMBER_EXISTS");
    throw error;
  }

  return Response.json({
    member: { id: memberId, email, displayName, role, isActive: true, hasAccount: true },
    credentials: temporaryPassword ? { email, temporaryPassword, mustChangePassword: true } : null,
  }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
