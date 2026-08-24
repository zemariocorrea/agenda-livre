import { cleanText, jsonError } from "@/lib/http";
import { siteAssetsBucket } from "@/lib/r2-storage";

export async function GET(request: Request) {
  const key = cleanText(new URL(request.url).searchParams.get("key"), 500);

  if (!key || !/^tenants\/[A-Za-z0-9_-]+\/(logo|cover|promotion)-[A-Za-z0-9-]+\.(png|jpg|webp)$/.test(key)) {
    return jsonError("Imagem não encontrada.", 404, "ASSET_NOT_FOUND");
  }

  const bucket = await siteAssetsBucket();
  if (!bucket) {
    return jsonError("Armazenamento de imagens indisponível.", 503, "SITE_ASSETS_NOT_CONFIGURED");
  }

  const object = await bucket.get(key);
  if (!object) return jsonError("Imagem não encontrada.", 404, "ASSET_NOT_FOUND");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");

  return new Response(object.body, { headers });
}
