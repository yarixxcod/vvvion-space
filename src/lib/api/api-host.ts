export const API_HOST = "api.vvvion.space";

/** Hostname only: strips scheme, path, port and a trailing DNS dot. */
export function apiHostName(value: string | null | undefined): string {
  let raw = (value || "").trim().toLowerCase();
  if (!raw) return "";
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  raw = (raw.split("/")[0] || "").replace(/\.+$/, "");
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end >= 0 ? raw.slice(1, end) : raw;
  }
  return raw.split(":")[0] || "";
}

export function isApiHost(value: string | null | undefined): boolean {
  return apiHostName(value) === API_HOST;
}

/** True when any comma-separated host candidate is the public API host. */
export function hasApiHost(values: Array<string | null | undefined>): boolean {
  for (const value of values) {
    for (const part of (value || "").split(",")) {
      if (isApiHost(part)) return true;
    }
  }
  return false;
}

/** The API host never serves the app. Only /v1 stays on this origin. */
export function apiHostDecision(method: string, pathname: string): "pass" | "redirect" | "missing" {
  if (pathname === "/v1" || pathname.startsWith("/v1/")) return "pass";
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD") return "redirect";
  return "missing";
}
