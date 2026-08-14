import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { services, tenants } from "@/db/schema";
import { jsonError } from "@/lib/http";
import { correlationIdFor, isDatabaseUnavailable, problemDetails } from "@/lib/problem-details";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("tenant") ?? "clinica-aurora";
  const correlationId = correlationIdFor(request);

  try {
    const db = await getDb();
    const tenant = await db.query.tenants.findFirst({ where: and(eq(tenants.slug, slug), eq(tenants.isActive, true)) });
    if (!tenant) return jsonError("Empresa não encontrada.", 404, "TENANT_NOT_FOUND");

    const catalog = await db.select({
      id: services.id,
      name: services.name,
      description: services.description,
      durationMinutes: services.durationMinutes,
      priceCents: services.priceCents,
      color: services.color,
    }).from(services).where(and(eq(services.tenantId, tenant.id), eq(services.isActive, true))).orderBy(asc(services.sortOrder), asc(services.name));

    return Response.json({
      tenant: { slug: tenant.slug, name: tenant.name, subtitle: tenant.subtitle, timezone: tenant.timezone, currency: tenant.currency, location: tenant.location },
      services: catalog,
    }, { headers: { "x-correlation-id": correlationId } });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Catalog request failed", {
      correlationId,
      tenantSlug: slug,
      errorMessage,
    });

    if (isDatabaseUnavailable(error)) {
      return problemDetails({
        status: 503,
        title: "Service Unavailable",
        detail: "Banco de dados local não está pronto. Confira o binding D1 `DB` e aplique as migrations locais.",
        code: "DATABASE_UNAVAILABLE",
        instance: url.pathname,
        correlationId,
      });
    }

    return problemDetails({
      status: 500,
      title: "Internal Server Error",
      detail: "Não foi possível carregar o catálogo.",
      code: "CATALOG_LOAD_FAILED",
      instance: url.pathname,
      correlationId,
    });
  }
}
