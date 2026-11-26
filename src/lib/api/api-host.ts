export const API_HOST = "api.vvvion.space";

export function apiHostName(value: string | null | undefined): string {
  return (value || "").split(",")[0]?.trim().split(":")[0]?.toLowerCase() || "";
}

export function isApiHost(value: string | null | undefined): boolean {
  return apiHostName(value) === API_HOST;
}

/** The API host never serves the app. Only /v1 stays on this origin. */
export function apiHostDecision(method: string, pathname: string): "pass" | "redirect" | "missing" {
  if (pathname === "/v1" || pathname.startsWith("/v1/")) return "pass";
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD") return "redirect";
  return "missing";
}
