import { jsonError } from "../http";

export function rejectCrossSiteMutation(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    if (new URL(origin).origin === new URL(request.url).origin) return null;
  } catch {
    // fall through
  }
  return jsonError("Origem da requisição não permitida.", 403, "INVALID_ORIGIN");
}

export function requestTooLarge(request: Request, maxBytes = 16_384): boolean {
  const raw = request.headers.get("content-length");
  if (!raw) return false;
  const length = Number(raw);
  return Number.isFinite(length) && length > maxBytes;
}
