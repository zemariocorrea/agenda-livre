import { redirect } from "next/navigation";
import { getD1 } from "../d1";
import { jsonError } from "../http";
import { getCurrentUser, type AuthenticatedUser } from "./session";

export async function platformAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: jsonError("Entre na sua conta para acessar a plataforma.", 401, "UNAUTHENTICATED") } as const;
  if (user.mustChangePassword) return { error: jsonError("Troque sua senha antes de continuar.", 403, "PASSWORD_CHANGE_REQUIRED") } as const;

  const admin = await resolvePlatformAdmin(user.id);
  if (!admin) return { error: jsonError("Seu usuário não possui acesso de administrador master.", 403, "PLATFORM_FORBIDDEN") } as const;
  return { user, admin } as const;
}

export async function adminTenant(slug = "clinica-aurora") {
  const user = await getCurrentUser();
  if (!user) return { error: jsonError("Entre na sua conta para acessar o painel.", 401, "UNAUTHENTICATED") } as const;
  if (user.mustChangePassword) return { error: jsonError("Troque sua senha antes de continuar.", 403, "PASSWORD_CHANGE_REQUIRED") } as const;

  const d1 = await getD1();
  const membership = await d1.prepare(`
    SELECT tenant.id AS tenant_id, tenant.slug, tenant.name, tenant.subtitle, tenant.timezone, tenant.currency,
           tenant.location, tenant.contact_email, tenant.plan, tenant.max_professionals, tenant.brand_color,
           tenant.hero_title, tenant.hero_description, tenant.custom_domain, tenant.is_active,
           member.id AS member_id, member.role, member.display_name, member.email
    FROM tenant_members AS member
    INNER JOIN tenants AS tenant ON tenant.id = member.tenant_id
    WHERE tenant.slug = ? AND tenant.is_active = 1
      AND member.user_id = ? AND member.is_active = 1
    LIMIT 1
  `).bind(slug, user.id).first<Record<string, unknown>>();

  if (membership) {
    return {
      user,
      tenant: tenantFromMembership(membership),
      member: {
        id: String(membership.member_id),
        role: String(membership.role),
        displayName: String(membership.display_name),
        email: String(membership.email),
      },
      isPlatformAdmin: false,
    } as const;
  }

  const master = await resolvePlatformAdmin(user.id);
  if (master) {
    const tenant = await d1.prepare("SELECT * FROM tenants WHERE slug = ? AND is_active = 1 LIMIT 1")
      .bind(slug).first<Record<string, unknown>>();
    if (tenant) {
      return {
        user,
        tenant: mapTenant(tenant),
        member: { id: master.id, role: "platform_admin", displayName: master.displayName, email: user.email },
        isPlatformAdmin: true,
      } as const;
    }
  }

  return { error: jsonError("Seu usuário não pertence a esta empresa.", 403, "FORBIDDEN") } as const;
}

export function requireTenantManager(role: string) {
  return ["owner", "admin", "platform_admin"].includes(role)
    ? null
    : jsonError("Somente administradores podem realizar esta operação.", 403, "MANAGER_REQUIRED");
}

export async function requirePlatformAdminPage(returnTo = "/plataforma") {
  const user = await requirePageUser(returnTo);
  const admin = await resolvePlatformAdmin(user.id);
  if (!admin) redirect("/acesso-negado");
  return { user, admin };
}

export async function requireTenantPage(slug: string, returnTo: string) {
  const user = await requirePageUser(returnTo);
  const access = await adminTenant(slug);
  if ("error" in access) redirect("/acesso-negado");
  return { user, access };
}

export async function requirePageUser(returnTo: string, allowPasswordChange = false): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`);
  if (user.mustChangePassword && !allowPasswordChange) redirect(`/alterar-senha?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`);
  return user;
}

export async function postLoginDestination(userId: string, requestedReturnTo?: string | null): Promise<string> {
  const safeRequested = safeReturnPath(requestedReturnTo || "");
  const d1 = await getD1();
  const master = await resolvePlatformAdmin(userId);
  const firstMembership = await d1.prepare(`
    SELECT tenant.slug FROM tenant_members AS member
    INNER JOIN tenants AS tenant ON tenant.id = member.tenant_id
    WHERE member.user_id = ? AND member.is_active = 1 AND tenant.is_active = 1
    ORDER BY CASE member.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, member.created_at
    LIMIT 1
  `).bind(userId).first<{ slug: string }>();

  if (safeRequested !== "/") {
    if (safeRequested.startsWith("/plataforma") && master) return safeRequested;
    if (safeRequested.startsWith("/admin")) {
      if (master) return safeRequested;
      const url = new URL(safeRequested, "https://agenda.local");
      const slug = url.searchParams.get("tenant") ?? "clinica-aurora";
      const allowed = await d1.prepare(`
        SELECT 1 AS allowed FROM tenant_members AS member
        INNER JOIN tenants AS tenant ON tenant.id = member.tenant_id
        WHERE member.user_id = ? AND member.is_active = 1 AND tenant.is_active = 1 AND tenant.slug = ?
        LIMIT 1
      `).bind(userId, slug).first();
      if (allowed) return safeRequested;
    }
  }

  if (master) return "/plataforma";
  if (firstMembership) return `/admin?tenant=${encodeURIComponent(firstMembership.slug)}`;
  return "/acesso-negado";
}

export function safeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://agenda.local");
    if (url.origin !== "https://agenda.local") return "/";
    if (["/login", "/api/auth/login", "/api/auth/logout"].includes(url.pathname)) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

async function resolvePlatformAdmin(userId: string) {
  const d1 = await getD1();
  const row = await d1.prepare(`
    SELECT id, display_name FROM platform_admins
    WHERE user_id = ? AND is_active = 1
    LIMIT 1
  `).bind(userId).first<{ id: string; display_name: string }>();
  return row ? { id: row.id, displayName: row.display_name } : null;
}

function tenantFromMembership(row: Record<string, unknown>) {
  return {
    id: String(row.tenant_id), slug: String(row.slug), name: String(row.name), subtitle: String(row.subtitle),
    timezone: String(row.timezone), currency: String(row.currency), location: String(row.location),
    contactEmail: String(row.contact_email), plan: String(row.plan), maxProfessionals: Number(row.max_professionals),
    brandColor: String(row.brand_color), heroTitle: String(row.hero_title), heroDescription: String(row.hero_description),
    customDomain: row.custom_domain ? String(row.custom_domain) : null, isActive: Boolean(row.is_active),
  };
}

function mapTenant(row: Record<string, unknown>) {
  return {
    id: String(row.id), slug: String(row.slug), name: String(row.name), subtitle: String(row.subtitle),
    timezone: String(row.timezone), currency: String(row.currency), location: String(row.location),
    contactEmail: String(row.contact_email), plan: String(row.plan), maxProfessionals: Number(row.max_professionals),
    brandColor: String(row.brand_color), heroTitle: String(row.hero_title), heroDescription: String(row.hero_description),
    customDomain: row.custom_domain ? String(row.custom_domain) : null, isActive: Boolean(row.is_active),
  };
}
