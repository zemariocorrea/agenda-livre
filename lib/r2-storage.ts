export type SiteAssetsObject = {
  body: ReadableStream<Uint8Array>;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
};

export type SiteAssetsBucket = {
  put(
    key: string,
    value: ReadableStream<Uint8Array>,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  get(key: string): Promise<SiteAssetsObject | null>;
};

export async function siteAssetsBucket(): Promise<SiteAssetsBucket | null> {
  const workers = await import("cloudflare:workers");
  const env = workers.env as unknown as { SITE_ASSETS?: SiteAssetsBucket };
  return env.SITE_ASSETS ?? null;
}
