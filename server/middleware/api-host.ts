import { apiHostDecision, hasApiHost } from "../../src/lib/api/api-host.ts";

interface ApiHostEvent {
  url: URL;
  req: { method?: string; headers: Headers };
}

function requestHosts(event: ApiHostEvent): Array<string | null | undefined> {
  const headers = event.req.headers;
  return [
    headers.get("x-forwarded-host"),
    headers.get("x-vercel-forwarded-host"),
    headers.get("host"),
    event.url?.host,
    event.url?.href,
  ];
}

export default function apiHostMiddleware(event: ApiHostEvent, next: () => unknown): unknown {
  if (!hasApiHost(requestHosts(event))) return next();
  const decision = apiHostDecision(event.req.method || "GET", event.url.pathname);
  if (decision === "pass") return next();
  if (decision === "redirect") {
    return new Response(null, {
      status: 302,
      headers: { location: "/v1/models", "cache-control": "no-store" },
    });
  }
  return new Response(JSON.stringify({ error: { message: "Not found.", type: "invalid_request_error", code: "not_found" } }), {
    status: 404,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
