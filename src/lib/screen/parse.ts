export type ScreenProvider = "youtube" | "rutube" | "vk";

export type ParsedVideo = {
  provider: ScreenProvider;
  externalId: string;
  embedUrl: string;
};

const YT = /^[A-Za-z0-9_-]{11}$/;
const RT = /^[a-f0-9]{32}$/;

export function parseVideoLink(input: string): ParsedVideo | null {
  const raw = input.trim();
  if (!raw || raw.length > 500) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") return youtube(parts[0] || "");
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    if (parts[0] === "watch") return youtube(url.searchParams.get("v") || "");
    if (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live" || parts[0] === "v") return youtube(parts[1] || "");
    return null;
  }
  if (host === "rutube.ru" || host === "m.rutube.ru") {
    if (parts[0] === "play" && parts[1] === "embed") return rutube(parts[2] || "");
    if (parts[0] === "video" || parts[0] === "shorts" || parts[0] === "embed") return rutube(parts[1] || "");
    return null;
  }
  if (host === "vk.com" || host === "m.vk.com" || host === "vkvideo.ru" || host === "m.vkvideo.ru") {
    if (url.pathname.includes("video_ext.php")) return vkPair(url.searchParams.get("oid") || "", url.searchParams.get("id") || "");
    const match = url.pathname.match(/\/(?:video|clip)(-?\d+)_(\d+)/);
    if (match) return vkPair(match[1] || "", match[2] || "");
    return null;
  }
  return null;
}

function youtube(id: string): ParsedVideo | null {
  if (!YT.test(id)) return null;
  return {
    provider: "youtube",
    externalId: id,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
  };
}

function rutube(id: string): ParsedVideo | null {
  const clean = id.toLowerCase();
  if (!RT.test(clean)) return null;
  return {
    provider: "rutube",
    externalId: clean,
    embedUrl: `https://rutube.ru/play/embed/${clean}`,
  };
}

function vkPair(oid: string, id: string): ParsedVideo | null {
  if (!/^-?\d{1,18}$/.test(oid) || !/^\d{1,18}$/.test(id)) return null;
  return {
    provider: "vk",
    externalId: `${oid}_${id}`,
    embedUrl: `https://vk.com/video_ext.php?oid=${encodeURIComponent(oid)}&id=${encodeURIComponent(id)}&hd=2`,
  };
}
