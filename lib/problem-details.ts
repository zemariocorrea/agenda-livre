export type ProblemDetailsOptions = {
  status: number;
  title: string;
  detail: string;
  code: string;
  instance: string;
  correlationId: string;
};

export function correlationIdFor(request: Request) {
  const incoming = request.headers.get("x-correlation-id")?.trim();
  if (incoming && incoming.length <= 128) return incoming;
  return crypto.randomUUID();
}

export function problemDetails(options: ProblemDetailsOptions) {
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: options.title,
      status: options.status,
      detail: options.detail,
      instance: options.instance,
      code: options.code,
      correlationId: options.correlationId,
    }),
    {
      status: options.status,
      headers: {
        "content-type": "application/problem+json; charset=utf-8",
        "x-correlation-id": options.correlationId,
      },
    },
  );
}

export function isDatabaseUnavailable(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("Cloudflare D1 binding `DB` is unavailable") ||
    error.message.toLowerCase().includes("no such table")
  );
}
