export const DISK_ID = /^[A-Za-z0-9_-]{16,64}$/;

const SITE = /^(?:www\.)?vvvion\.space$/;

export function diskPath(id: string): string {
  return `/api/disk/${id}`;
}

export function isDiskPath(value: string): boolean {
  return /^\/api\/disk\/[A-Za-z0-9_-]{16,64}$/.test(value);
}

/** A disk file as stored in a chat: a site path, or the same path on vvvion.space. */
export function asDiskPath(value: string): string | null {
  if (isDiskPath(value)) return value;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (!SITE.test(parsed.hostname)) return null;
    return isDiskPath(parsed.pathname) ? parsed.pathname : null;
  } catch {
    return null;
  }
}

function mentionedDisk(value: string, path: string): boolean {
  return asDiskPath(value.split("?")[0] || "") === path;
}

/** True when this shared snapshot points at that disk file. */
export function shareReferencesDisk(messages: unknown, id: string): boolean {
  if (!DISK_ID.test(id) || !Array.isArray(messages)) return false;
  const path = diskPath(id);
  for (const item of messages) {
    if (!item || typeof item !== "object") continue;
    const raw = item as { imageUrl?: unknown; files?: unknown };
    if (typeof raw.imageUrl === "string" && mentionedDisk(raw.imageUrl, path)) return true;
    if (!Array.isArray(raw.files)) continue;
    for (const file of raw.files) {
      if (!file || typeof file !== "object") continue;
      const url = (file as { url?: unknown }).url;
      if (typeof url === "string" && mentionedDisk(url, path)) return true;
    }
  }
  return false;
}

/** Chat-share capability: ?c= on the file, or the page /s/<token> that asked for it. */
export function chatShareToken(requestUrl: string, referer: string | null): string {
  let current: URL;
  try {
    current = new URL(requestUrl);
  } catch {
    return "";
  }
  const query = current.searchParams.get("c") || "";
  if (DISK_ID.test(query)) return query;
  if (!referer) return "";
  try {
    const from = new URL(referer);
    if (from.origin !== current.origin) return "";
    const match = /^\/s\/([A-Za-z0-9_-]{16,64})\/?$/.exec(from.pathname);
    const token = match?.[1] || "";
    return DISK_ID.test(token) ? token : "";
  } catch {
    return "";
  }
}

export function withChatShare(url: string, token: string): string {
  const path = asDiskPath(url);
  if (!path || !DISK_ID.test(token)) return url;
  return `${path}?c=${token}`;
}

/** URL an <img> may use. Disk files stay on this site; a chat share may add ?c=. */
export function loadableImageUrl(url?: string): string {
  if (!url) return "";
  const cut = url.indexOf("?");
  const path = cut === -1 ? url : url.slice(0, cut);
  if (isDiskPath(path)) {
    if (cut === -1) return path;
    const query = url.slice(cut);
    return /^\?c=[A-Za-z0-9_-]{16,64}$/.test(query) ? `${path}${query}` : "";
  }
  if (url.startsWith("data:image/") && url.length < 2_800_000) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return parsed.toString();
  } catch {
    return "";
  }
  return "";
}
