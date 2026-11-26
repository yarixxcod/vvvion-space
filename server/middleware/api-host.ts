import { apiHostDecision, isApiHost } from "../../src/lib/api/api-host.ts";

interface ApiHostEvent {
  url: URL;
  req: { method?: string; headers: Headers };
}

function requestHost(event: ApiHostEvent): string {
  return event.req.headers.get("x-forwarded-host") ?? event.req.headers.get("host") ?? event.url.host;
}

export default function apiHostMiddleware(event: ApiHostEvent, next: () => unknown): unknown {
  if (!isApiHost(requestHost(event))) return next();
  const decision = apiHostDecision(event.req.method || "GET", event.url.pathname);
  if (decision === "pass") return next();
  if (decision === "redirect") {
    return Response.redirect(new URL("/v1/models", event.url), 302);
  }
  return new Response(JSON.stringify({ error: { message: "Not found.", type: "invalid_request_error", code: "not_found" } }), {
    status: 404,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
