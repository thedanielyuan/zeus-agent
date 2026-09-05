/**
 * Same-origin gate for mutating routes (PRD FR-X2). Browsers send Fetch
 * Metadata on every request; fall back to an Origin/Host comparison for
 * clients that don't, and allow requests with no Origin at all (curl).
 */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ code, message }, { status });
}
