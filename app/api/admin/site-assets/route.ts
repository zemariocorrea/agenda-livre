import { adminTenant, requireTenantManager } from "@/lib/admin-auth";
import { jsonError } from "@/lib/http";
import { rejectCrossSiteMutation } from "@/lib/auth/request";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ALLOWED_KINDS = new Set(["logo", "cover", "promotion"]);

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const access = await adminTenant(new URL(request.url).searchParams.get("tenant") ?? "clinica-aurora");
  if ("error" in access) return access.error;

  const forbidden = requireTenantManager(access.member.role);
  if (forbidden) return forbidden;

  const form = await request.formData();
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "");

  if (!(file instanceof File)) {
    return jsonError("Selecione uma imagem.", 400, "IMAGE_REQUIRED");
  }

  if (!ALLOWED_KINDS.has(kind)) {
    return jsonError("Tipo de imagem inválido.", 400, "INVALID_IMAGE_KIND");
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return jsonError("Use uma imagem PNG, JPG ou WEBP.", 400, "INVALID_IMAGE_TYPE");
  }

  const maxBytes = kind === "logo" ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
  if (file.size <= 0 || file.size > maxBytes) {
    return jsonError(
      kind === "logo" ? "A logo deve ter no máximo 2 MB." : "A imagem deve ter no máximo 5 MB.",
      400,
      "IMAGE_TOO_LARGE",
    );
  }

  const bucket = await siteAssetsBucket();
  if (!bucket) {
    return jsonError(
      "O armazenamento de imagens ainda não foi configurado. Configure o binding R2 SITE_ASSETS.",
      503,
      "SITE_ASSETS_NOT_CONFIGURED",
    );
  }

  const extension = extensionFor(file.type);
  const key = `tenants/${access.tenant.id}/${kind}-${crypto.randomUUID()}.${extension}`;

  await bucket.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: {
      tenantId: access.tenant.id,
      kind,
      originalName: file.name.slice(0, 180),
    },
  });

  const url = `/api/public/site-assets?key=${encodeURIComponent(key)}`;

  return Response.json({
    key,
    url,
  }, { status: 201 });
}

type SiteAssetsBucket = {
  put(
    key: string,
    value: Blob | ReadableStream | ArrayBufferView | ArrayBuffer | string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
};

async function siteAssetsBucket(): Promise<SiteAssetsBucket | null> {
  const workers = await import("cloudflare:workers");
  const env = workers.env as unknown as { SITE_ASSETS?: SiteAssetsBucket };
  return env.SITE_ASSETS ?? null;
}

function extensionFor(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}