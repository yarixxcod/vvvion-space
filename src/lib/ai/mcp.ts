export type McpLink = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  tools: string[];
};

const KEY = "vvvion.mcp";
const MAX = 4;

export function loadMcp(): McpLink[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Partial<McpLink>;
      const url = typeof row.url === "string" ? row.url.trim() : "";
      if (!url.startsWith("https://") || url.length > 300) return [];
      const name = (typeof row.name === "string" ? row.name : "").trim().slice(0, 40) || hostOf(url);
      const tools = Array.isArray(row.tools) ? row.tools.filter((tool): tool is string => typeof tool === "string").slice(0, 24) : [];
      return [{ id: typeof row.id === "string" && row.id ? row.id.slice(0, 40) : crypto.randomUUID(), name, url, enabled: row.enabled !== false, tools }];
    }).slice(0, MAX);
  } catch {
    return [];
  }
}

export function saveMcp(rows: McpLink[]) {
  const next = rows.slice(0, MAX).map((row) => ({
    id: row.id,
    name: row.name.trim().slice(0, 40) || hostOf(row.url),
    url: row.url.trim(),
    enabled: row.enabled,
    tools: row.tools.slice(0, 24),
  }));
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function enabledMcpUrls(): string[] {
  return loadMcp().filter((row) => row.enabled).map((row) => row.url).slice(0, MAX);
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "MCP";
  }
}
