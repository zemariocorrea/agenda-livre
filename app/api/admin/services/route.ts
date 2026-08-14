import { adminTenant } from "@/lib/admin-auth";
import { getD1 } from "@/lib/d1";
import { cleanText, jsonError } from "@/lib/http";

export async function GET(request: Request) {
  const d1 = await getD1();
  const slug = new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora";
  const access = await adminTenant(slug);
  if ("error" in access) return access.error;
  const rows = await d1.prepare("SELECT id, name, description, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents, color, is_active, sort_order FROM services WHERE tenant_id = ? ORDER BY sort_order, name").bind(access.tenant.id).all();
  return Response.json({ services: rows.results });
}

export async function POST(request: Request) {
  const d1 = await getD1();
  const url = new URL(request.url);
  const access = await adminTenant(url.searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const payload = await request.json() as Record<string, unknown>;
  const name = cleanText(payload.name, 120);
  const description = cleanText(payload.description, 500);
  const duration = Number(payload.durationMinutes);
  const priceCents = Number(payload.priceCents);
  if (!name || !Number.isInteger(duration) || duration < 5 || duration > 720 || !Number.isInteger(priceCents) || priceCents < 0) return jsonError("Informe nome, duração e preço válidos.");
  const id = crypto.randomUUID();
  await d1.batch([
    d1.prepare("INSERT INTO services (id, tenant_id, name, description, duration_minutes, price_cents, color, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM services WHERE tenant_id = ?), 1))")
      .bind(id, access.tenant.id, name, description, duration, priceCents, cleanText(payload.color, 20) || "#17624f", access.tenant.id),
    d1.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, 'service.created', 'service', ?, ?)")
      .bind(crypto.randomUUID(), access.tenant.id, access.user.email, id, JSON.stringify({ name, duration, priceCents })),
  ]);
  return Response.json({ service: { id, name, description, durationMinutes: duration, priceCents } }, { status: 201 });
}
