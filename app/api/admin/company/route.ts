import { adminTenant, requireTenantManager } from "@/lib/admin-auth";
import { getD1 } from "@/lib/d1";
import { cleanText, isEmail, jsonError, normalizeEmail } from "@/lib/http";
import { rejectCrossSiteMutation } from "@/lib/auth/request";

const SITE_TEMPLATES = new Set(["modern", "classic", "direct"]);

export async function GET(request: Request) {
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;

  const d1 = await getD1();
  const company = await d1.prepare(`
    SELECT
      id,
      slug,
      name,
      subtitle,
      timezone,
      currency,
      location,
      contact_email,
      plan,
      max_professionals,
      brand_color,
      secondary_color,
      hero_title,
      hero_description,
      logo_url,
      cover_image_url,
      site_template,
      promotion_enabled,
      promotion_title,
      promotion_description,
      promotion_image_url,
      payment_enabled,
      pix_enabled,
      pay_on_site_enabled,
      contact_for_payment_enabled,
      pix_key,
      pix_key_type,
      pix_holder_name,
      require_payment_to_confirm,
      custom_domain,
      is_active
    FROM tenants
    WHERE id = ?
    LIMIT 1
  `).bind(access.tenant.id).first();

  return Response.json({
    company,
    canManage: !requireTenantManager(access.member.role),
  });
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
  const current = await d1.prepare("SELECT * FROM tenants WHERE id = ? LIMIT 1")
    .bind(access.tenant.id)
    .first<Record<string, unknown>>();

  if (!current) return jsonError("Empresa não encontrada.", 404, "TENANT_NOT_FOUND");

  const name = cleanText(payload.name ?? current.name, 120);
  const contactEmail = normalizeEmail(payload.contactEmail ?? current.contact_email);
  const brandColor = normalizeHexColor(payload.brandColor ?? current.brand_color, "#17624f");
  const secondaryColor = normalizeHexColor(payload.secondaryColor ?? current.secondary_color, "#f2ac72");
  const siteTemplate = cleanText(payload.siteTemplate ?? current.site_template, 20) || "modern";

  if (!name || (contactEmail && !isEmail(contactEmail))) {
    return jsonError("Informe nome e e-mail válidos.");
  }

  if (!SITE_TEMPLATES.has(siteTemplate)) {
    return jsonError("Modelo de site inválido.", 400, "INVALID_SITE_TEMPLATE");
  }

  const promotionEnabled = typeof payload.promotionEnabled === "boolean"
    ? payload.promotionEnabled
    : Boolean(current.promotion_enabled);
  const paymentEnabled = typeof payload.paymentEnabled === "boolean" ? payload.paymentEnabled : Boolean(current.payment_enabled);
  const pixEnabled = typeof payload.pixEnabled === "boolean" ? payload.pixEnabled : Boolean(current.pix_enabled);
  const payOnSiteEnabled = typeof payload.payOnSiteEnabled === "boolean" ? payload.payOnSiteEnabled : Boolean(current.pay_on_site_enabled);
  const contactForPaymentEnabled = typeof payload.contactForPaymentEnabled === "boolean" ? payload.contactForPaymentEnabled : Boolean(current.contact_for_payment_enabled);
  const requirePaymentToConfirm = typeof payload.requirePaymentToConfirm === "boolean" ? payload.requirePaymentToConfirm : Boolean(current.require_payment_to_confirm);
  const pixKey = cleanText(payload.pixKey ?? current.pix_key, 180);
  const pixKeyType = cleanText(payload.pixKeyType ?? current.pix_key_type, 40);
  const pixHolderName = cleanText(payload.pixHolderName ?? current.pix_holder_name, 160);

  if (paymentEnabled && !pixEnabled && !payOnSiteEnabled && !contactForPaymentEnabled) {
    return jsonError("Habilite ao menos uma forma de pagamento.", 400, "PAYMENT_METHOD_REQUIRED");
  }
  if (paymentEnabled && pixEnabled && !pixKey) {
    return jsonError("Informe a chave Pix para habilitar pagamentos via Pix.", 400, "PIX_KEY_REQUIRED");
  }

  await d1.batch([
    d1.prepare(`
      UPDATE tenants
      SET
        name = ?,
        subtitle = ?,
        location = ?,
        timezone = ?,
        contact_email = ?,
        brand_color = ?,
        secondary_color = ?,
        hero_title = ?,
        hero_description = ?,
        logo_url = ?,
        cover_image_url = ?,
        site_template = ?,
        promotion_enabled = ?,
        promotion_title = ?,
        promotion_description = ?,
        promotion_image_url = ?,
        payment_enabled = ?,
        pix_enabled = ?,
        pay_on_site_enabled = ?,
        contact_for_payment_enabled = ?,
        pix_key = ?,
        pix_key_type = ?,
        pix_holder_name = ?,
        require_payment_to_confirm = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      name,
      cleanText(payload.subtitle ?? current.subtitle, 160),
      cleanText(payload.location ?? current.location, 160),
      cleanText(payload.timezone ?? current.timezone, 80),
      contactEmail,
      brandColor,
      secondaryColor,
      cleanText(payload.heroTitle ?? current.hero_title, 220),
      cleanText(payload.heroDescription ?? current.hero_description, 500),
      cleanAssetUrl(payload.logoUrl ?? current.logo_url),
      cleanAssetUrl(payload.coverImageUrl ?? current.cover_image_url),
      siteTemplate,
      promotionEnabled ? 1 : 0,
      cleanText(payload.promotionTitle ?? current.promotion_title, 160),
      cleanText(payload.promotionDescription ?? current.promotion_description, 400),
      cleanAssetUrl(payload.promotionImageUrl ?? current.promotion_image_url),
      paymentEnabled ? 1 : 0,
      pixEnabled ? 1 : 0,
      payOnSiteEnabled ? 1 : 0,
      contactForPaymentEnabled ? 1 : 0,
      pixKey,
      pixKeyType,
      pixHolderName,
      requirePaymentToConfirm ? 1 : 0,
      access.tenant.id,
    ),
    d1.prepare(`
      INSERT INTO audit_log (
        id, tenant_id, actor, action, entity_type, entity_id, metadata_json
      ) VALUES (?, ?, ?, 'tenant.site.updated', 'tenant', ?, ?)
    `).bind(
      crypto.randomUUID(),
      access.tenant.id,
      access.user.email,
      access.tenant.id,
      JSON.stringify({
        name,
        contactEmail,
        siteTemplate,
        promotionEnabled,
        paymentEnabled,
        pixEnabled,
        payOnSiteEnabled,
        contactForPaymentEnabled,
        requirePaymentToConfirm,
      }),
    ),
  ]);

  return Response.json({ saved: true });
}

function normalizeHexColor(value: unknown, fallback: string) {
  const color = cleanText(value, 20);
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : fallback;
}

function cleanAssetUrl(value: unknown) {
  const url = cleanText(value, 700);
  if (!url) return "";
  if (url.startsWith("/api/public/site-assets?key=")) return url;
  if (/^https:\/\/[^\s]+$/i.test(url)) return url;
  return "";
}