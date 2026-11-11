export type AppSearch = { place?: CircleTab; chat?: string; room?: string; lang?: "ru" | "en" | "kk" };

const ID = /^[A-Za-z0-9_-]{8,80}$/;
const TABS = ["chat", "feed", "play", "services", "disk", "bank", "shop", "admin"] as const;
type CircleTab = (typeof TABS)[number];

function isTab(value: string): value is CircleTab {
  return (TABS as readonly string[]).includes(value);
}

/** Keep only a path on this site. Full URLs are accepted solely for vvvion.space. */
export function parseSitePath(input: string): string | null {
  const raw = input.trim();
  if (!raw || raw.length > 500) return null;
  let path = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      if (host !== "vvvion.space" && host !== "www.vvvion.space") return null;
      path = `${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (/[\s\\]/.test(path) || path.includes("://")) return null;
  return path.slice(0, 300);
}

export function destinationFor(input: string): { to: "/"; search: AppSearch } | null {
  const path = parseSitePath(input);
  if (!path) return null;
  const bare = path.split("?")[0]?.replace(/\/+$/, "") || "/";
  const chat = /^\/chat\/([^/]+)$/.exec(bare);
  if (chat?.[1] && ID.test(decodeURIComponent(chat[1]))) {
    return { to: "/", search: { chat: decodeURIComponent(chat[1]) } };
  }
  const message = /^\/messages\/([^/]+)$/.exec(bare);
  if (message?.[1] && ID.test(decodeURIComponent(message[1]))) {
    return { to: "/", search: { place: "chat", room: decodeURIComponent(message[1]) } };
  }
  if (bare === "/messages" || bare === "/c/messages") return { to: "/", search: { place: "chat" } };
  if (bare === "/disk" || bare === "/c/disk") return { to: "/", search: { place: "disk" } };
  if (bare === "/shop" || bare === "/c/shop") return { to: "/", search: { place: "shop" } };
  const section = /^\/c\/([^/]+)$/.exec(bare);
  if (section?.[1] && isTab(section[1])) return { to: "/", search: { place: section[1] } };
  if (bare === "/" || bare === "") return { to: "/", search: {} };
  return null;
}
