import { adminTenant } from "@/lib/admin-auth";
import { getD1 } from "@/lib/d1";
import { cleanText, jsonError } from "@/lib/http";
import { rejectCrossSiteMutation } from "@/lib/auth/request";

export async function GET(request: Request) {
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const d1 = await getD1();
  const rows = await d1.prepare("SELECT blocked.id, blocked.professional_id, blocked.starts_at_utc, blocked.ends_at_utc, blocked.reason, blocked.created_at, professional.name AS professional_name FROM blocked_periods AS blocked LEFT JOIN professionals AS professional ON professional.id = blocked.professional_id AND professional.tenant_id = blocked.tenant_id WHERE blocked.tenant_id = ? AND blocked.ends_at_utc >= datetime('now', '-30 days') ORDER BY blocked.starts_at_utc")
    .bind(access.tenant.id).all();
  return Response.json({ blocks: rows.results });
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;
  const d1 = await getD1();
  const payload = await request.json() as Record<string, unknown>;
  const professionalId = cleanText(payload.professionalId, 100) || null;
  const startsAt = new Date(String(payload.startsAtUtc ?? ""));
  const endsAt = new Date(String(payload.endsAtUtc ?? ""));
  const reason = cleanText(payload.reason, 300) || "Bloqueio manual";
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || startsAt >= endsAt) return jsonError("Informe um período válido.");
  if (professionalId) {
    const professional = await d1.prepare("SELECT id FROM professionals WHERE id = ? AND tenant_id = ? LIMIT 1").bind(professionalId, access.tenant.id).first();
    if (!professional) return jsonError("Profissional não pertence a esta empresa.", 404, "PROFESSIONAL_NOT_FOUND");
  }
  const id = crypto.randomUUID();
  await d1.batch([
    d1.prepare("INSERT INTO blocked_periods (id, tenant_id, professional_id, starts_at_utc, ends_at_utc, reason) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, access.tenant.id, professionalId, startsAt.toISOString(), endsAt.toISOString(), reason),
    d1.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, 'blocked_period.created', 'blocked_period', ?, ?)")
      .bind(crypto.randomUUID(), access.tenant.id, access.user.email, id, JSON.stringify({ professionalId, reason })),
  ]);
  return Response.json({ block: { id, professionalId, startsAtUtc: startsAt.toISOString(), endsAtUtc: endsAt.toISOString(), reason } }, { status: 201 });
}
