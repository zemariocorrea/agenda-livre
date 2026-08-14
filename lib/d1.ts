export async function getD1(): Promise<D1Database> {
  const workers = await import("cloudflare:workers");
  if (!workers.env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  return workers.env.DB;
}
