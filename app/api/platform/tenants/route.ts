import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import { rejectCrossSiteMutation } from "@/lib/auth/request";
import { platformAdmin } from "@/lib/admin-auth";
import { getD1 } from "@/lib/d1";
import { cleanText, isEmail, jsonError, normalizeEmail, normalizeSlug } from "@/lib/http";

export async function GET(request: Request) {
  const access = await platformAdmin();
  if ("error" in access) return access.error;
  const d1 = await getD1();
  const search = cleanText(new URL(request.url).searchParams.get("search"), 120);
  const pattern = `%${search.replaceAll("%", "").replaceAll("_", "")}%`;
  const rows = await d1.prepare(`
    SELECT tenant.id, tenant.slug, tenant.name, tenant.subtitle, tenant.location, tenant.contact_email,
           tenant.plan, tenant.max_professionals, tenant.brand_color, tenant.custom_domain,
           tenant.is_active, tenant.created_at,
           (SELECT COUNT(*) FROM tenant_members WHERE tenant_id = tenant.id AND is_active = 1) AS administrators,
           (SELECT COUNT(*) FROM professionals WHERE tenant_id = tenant.id AND is_active = 1) AS professionals,
           (SELECT COUNT(*) FROM services WHERE tenant_id = tenant.id AND is_active = 1) AS services,
           (SELECT COUNT(*) FROM appointments WHERE tenant_id = tenant.id) AS appointments
    FROM tenants AS tenant
    WHERE (? = '' OR tenant.name LIKE ? OR tenant.slug LIKE ? OR tenant.contact_email LIKE ?)
    ORDER BY tenant.is_active DESC, tenant.created_at DESC, tenant.name
  `).bind(search, pattern, pattern, pattern).all();
  return Response.json({ tenants: rows.results });
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const access = await platformAdmin();
  if ("error" in access) return access.error;

  const d1 = await getD1();
  const payload = await request.json() as Record<string, unknown>;
  const name = cleanText(payload.name, 120);
  const slug = normalizeSlug(payload.slug || name);
  const subtitle = cleanText(payload.subtitle, 160) || "Agendamento online";
  const location = cleanText(payload.location, 160);
  const timezone = cleanText(payload.timezone, 80) || "America/Sao_Paulo";
  const contactEmail = normalizeEmail(payload.contactEmail ?? payload.ownerEmail);
  const ownerName = cleanText(payload.ownerName, 120);
  const ownerEmail = normalizeEmail(payload.ownerEmail);
  const plan = ["trial", "essential", "professional"].includes(String(payload.plan)) ? String(payload.plan) : "essential";
  const maxProfessionals = clampInteger(payload.maxProfessionals, 1, 500, plan === "professional" ? 50 : 10);
  const brandColor = cleanText(payload.brandColor, 20) || "#17624f";
  const createProfessional = payload.createProfessional !== false;
  const professionalName = cleanText(payload.professionalName, 120) || ownerName;
  const professionalTitle = cleanText(payload.professionalTitle, 120) || "Profissional";
  if (!name || slug.length < 3 || !ownerName || !isEmail(ownerEmail) || (contactEmail && !isEmail(contactEmail)) || !isTimeZone(timezone)) {
    return jsonError("Informe empresa, endereço, responsável, e-mail e fuso válidos.");
  }

  const existingUser = await d1.prepare("SELECT id, is_active FROM users WHERE email = ? LIMIT 1")
    .bind(ownerEmail).first<{ id: string; is_active: number }>();
  if (existingUser && !existingUser.is_active) {
    return jsonError("O e-mail informado pertence a uma conta desativada.", 409, "USER_INACTIVE");
  }

  const tenantId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const ownerUserId = existingUser?.id ?? crypto.randomUUID();
  const professionalId = crypto.randomUUID();
  const temporaryPassword = existingUser ? null : generateTemporaryPassword();
  const passwordHash = temporaryPassword ? await hashPassword(temporaryPassword) : null;

  const statements: D1PreparedStatement[] = [];
  if (passwordHash) {
    statements.push(d1.prepare(`
      INSERT INTO users (id, email, display_name, password_hash, must_change_password)
      VALUES (?, ?, ?, ?, 1)
    `).bind(ownerUserId, ownerEmail, ownerName, passwordHash));
  }

  statements.push(
    d1.prepare(`
      INSERT INTO tenants (
        id, slug, name, subtitle, timezone, currency, location, contact_email,
        plan, max_professionals, brand_color, hero_title, hero_description
      ) VALUES (?, ?, ?, ?, ?, 'BRL', ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId, slug, name, subtitle, timezone, location, contactEmail || ownerEmail,
      plan, maxProfessionals, brandColor,
      cleanText(payload.heroTitle, 220) || "Seu cuidado começa com um horário só seu.",
      cleanText(payload.heroDescription, 500) || "Escolha o atendimento, encontre o melhor horário e confirme em poucos passos.",
    ),
    d1.prepare("INSERT INTO tenant_members (id, tenant_id, user_id, email, display_name, role) VALUES (?, ?, ?, ?, ?, 'owner')")
      .bind(ownerId, tenantId, ownerUserId, ownerEmail, ownerName),
  );

  if (createProfessional && professionalName) {
    statements.push(d1.prepare("INSERT INTO professionals (id, tenant_id, member_id, name, title, email, color, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, 1)")
      .bind(professionalId, tenantId, ownerId, professionalName, professionalTitle, ownerEmail, brandColor));
  }

  statements.push(d1.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, 'tenant.created', 'tenant', ?, ?)")
    .bind(crypto.randomUUID(), tenantId, access.user.email, tenantId, JSON.stringify({ name, slug, ownerEmail, plan, createProfessional, accountCreated: Boolean(temporaryPassword) })));

  try {
    await d1.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("tenants.slug") || message.includes("UNIQUE constraint")) {
      return jsonError("Esse endereço público ou e-mail já está em uso nessa empresa.", 409, "TENANT_CONFLICT");
    }
    throw error;
  }

  return Response.json({
    tenant: { id: tenantId, slug, name, subtitle, timezone, location, contactEmail: contactEmail || ownerEmail, plan, maxProfessionals, brandColor, isActive: true },
    owner: { id: ownerId, name: ownerName, email: ownerEmail },
    professionalId: createProfessional ? professionalId : null,
    credentials: temporaryPassword ? { email: ownerEmail, temporaryPassword, mustChangePassword: true } : null,
  }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function isTimeZone(value: string) {
  try { new Intl.DateTimeFormat("pt-BR", { timeZone: value }).format(); return true; } catch { return false; }
}
