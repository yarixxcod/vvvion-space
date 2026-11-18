const ORIGIN = "https://vvvion.space";

function blocked(value: string) {
  if (value.includes("\\")) return true;
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) < 32) return true;
  return false;
}

/** Internal path only. Blocks open redirects, including encoded `//host`. */
export function safeAppPath(value: unknown): string {
  if (typeof value !== "string") return "/";
  const raw = value.trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || blocked(raw)) return "/";
  let url: URL;
  try {
    url = new URL(raw, ORIGIN);
  } catch {
    return "/";
  }
  if (url.origin !== ORIGIN) return "/";
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    return "/";
  }
  if (!path.startsWith("/") || path.startsWith("//") || blocked(path)) return "/";
  if (path === "/login" || path.startsWith("/login/")) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
