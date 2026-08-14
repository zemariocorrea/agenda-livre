import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "../app/chatgpt-auth";
import { getDb } from "../db";
import { getD1 } from "./d1";
import { tenantMembers, tenants } from "../db/schema";

export async function adminTenant(slug = "clinica-aurora") {
  const user = await getChatGPTUser();
  if (!user) return { error: Response.json({ error: { code: "UNAUTHENTICATED", message: "Entre na sua conta para acessar o painel." } }, { status: 401 }) } as const;
  const db = await getDb();
  const normalizedEmail = user.email.toLowerCase();
  let rows = await findMembership(db, slug, normalizedEmail);

  const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (!rows[0] && bootstrapEmail && bootstrapEmail === normalizedEmail) {
    const d1 = await getD1();
    const claimed = await d1.prepare(
      "UPDATE tenant_members SET email = ?, display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = (SELECT id FROM tenants WHERE slug = ? AND is_active = 1 LIMIT 1) AND role = 'owner' AND email LIKE '%.example'",
    ).bind(normalizedEmail, user.fullName ?? user.displayName, slug).run();
    if (claimed.meta.changes) rows = await findMembership(db, slug, normalizedEmail);
  }

  if (!rows[0]) return { error: Response.json({ error: { code: "FORBIDDEN", message: "Seu usuário não pertence a esta empresa." } }, { status: 403 }) } as const;
  return { user, tenant: rows[0].tenant, member: rows[0].member } as const;
}

function findMembership(db: Awaited<ReturnType<typeof getDb>>, slug: string, email: string) {
  return db.select({ tenant: tenants, member: tenantMembers }).from(tenantMembers)
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .where(and(eq(tenants.slug, slug), eq(tenants.isActive, true), eq(tenantMembers.email, email), eq(tenantMembers.isActive, true)))
    .limit(1);
}
