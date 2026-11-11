import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type McpToolDef = {
  exposed: string;
  name: string;
  description: string;
  schema: Record<string, unknown>;
};

type Pack = {
  tools: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }[];
  invoke: (exposed: string, args: unknown) => Promise<string>;
};

const sessions = new Map<string, { id: string; until: number }>();

export function mcpUrlShape(raw: string): string | null {
  const text = raw.trim();
  if (text.length < 12 || text.length > 300) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal") return null;
  if (isIP(host) && blockedIp(host)) return null;
  url.hash = "";
  return url.toString();
}

export function mcpUrlsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const url = mcpUrlShape(item);
    if (!url || out.includes(url)) continue;
    out.push(url);
    if (out.length >= 4) break;
  }
  return out;
}

function blockedIp(ip: string): boolean {
  const value = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped?.[1]) return blockedIp(mapped[1]);
  if (value === "::1" || value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd")) return true;
  if (value.includes(":")) return false;
  const parts = value.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

async function publicUrl(raw: string): Promise<string> {
  const url = mcpUrlShape(raw);
  if (!url) throw new Error("Нужна ссылка https на сервер MCP");
  const host = new URL(url).hostname;
  if (!isIP(host)) {
    const rows = await lookup(host, { all: true }).catch(() => []);
    if (!rows.length || rows.some((row) => blockedIp(row.address))) throw new Error("Эта ссылка ведёт во внутреннюю сеть");
  }
  return url;
}

function toolKey(index: number, name: string): string {
  const clean = name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "").slice(0, 48) || "tool";
  return `m${index}_${clean}`.slice(0, 64);
}

async function readBody(res: Response): Promise<unknown> {
  const type = res.headers.get("content-type") || "";
  if (type.includes("text/event-stream")) {
    const text = await res.text();
    let last: unknown = null;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        last = JSON.parse(payload);
      } catch {
        /* keep the previous event */
      }
    }
    if (!last) throw new Error("Сервер MCP прислал пустой ответ");
    return last;
  }
  return res.json();
}

async function rpc(url: string, method: string, params: unknown, id?: number): Promise<unknown> {
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "user-agent": "vvvion-mcp",
  });
  const saved = sessions.get(url);
  if (saved && saved.until > Date.now()) headers.set("mcp-session-id", saved.id);
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(id == null ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }),
    redirect: "manual",
    signal: AbortSignal.timeout(12_000),
  });
  const session = res.headers.get("mcp-session-id");
  if (session && session.length < 200) sessions.set(url, { id: session, until: Date.now() + 10 * 60_000 });
  if (res.status >= 300 && res.status < 400) throw new Error("Сервер MCP перенаправил запрос");
  if (res.status === 401 || res.status === 403) throw new Error("Сервер MCP не пустил по этой ссылке");
  if (!res.ok) {
    console.error("[mcp]", new URL(url).hostname, res.status, method);
    throw new Error("Сервер MCP не ответил");
  }
  if (id == null) return null;
  const body = (await readBody(res)) as { result?: unknown; error?: { message?: string } };
  if (body?.error) throw new Error(body.error.message?.slice(0, 180) || "Сервер MCP отклонил запрос");
  return body?.result ?? null;
}

async function openSession(url: string) {
  await rpc(url, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "vvvion", version: "1" },
  }, 1);
  await rpc(url, "notifications/initialized", {}).catch(() => undefined);
}

async function toolsOf(url: string, index: number): Promise<McpToolDef[]> {
  await openSession(url);
  const listed = (await rpc(url, "tools/list", {}, 2)) as { tools?: { name?: string; description?: string; inputSchema?: Record<string, unknown> }[] } | null;
  const rows = Array.isArray(listed?.tools) ? listed.tools : [];
  return rows.slice(0, 16).flatMap((tool) => {
    const name = typeof tool.name === "string" ? tool.name.trim() : "";
    if (!name || name.length > 80) return [];
    const schema = tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : { type: "object", properties: {} };
    return [{
      exposed: toolKey(index, name),
      name,
      description: (tool.description || name).replace(/\s+/g, " ").trim().slice(0, 400),
      schema,
    }];
  });
}

function textOf(result: unknown): string {
  if (!result || typeof result !== "object") return "Инструмент ничего не вернул";
  const row = result as { isError?: boolean; content?: unknown; structuredContent?: unknown };
  const bits: string[] = [];
  if (Array.isArray(row.content)) {
    for (const part of row.content) {
      if (part && typeof part === "object" && typeof (part as { text?: string }).text === "string") bits.push((part as { text: string }).text);
    }
  } else if (typeof row.content === "string") bits.push(row.content);
  if (!bits.length && row.structuredContent) bits.push(JSON.stringify(row.structuredContent));
  const text = bits.join("\n").trim().slice(0, 6000);
  const body = text || "Инструмент ничего не вернул";
  return row.isError ? `Ошибка инструмента: ${body}` : body;
}

export async function prepareMcp(urls: string[]): Promise<Pack | null> {
  const defs: McpToolDef[] = [];
  const where = new Map<string, { url: string; name: string }>();
  for (let index = 0; index < urls.length && defs.length < 16; index += 1) {
    try {
      const url = await publicUrl(urls[index] || "");
      const tools = await toolsOf(url, index);
      for (const tool of tools) {
        if (where.has(tool.exposed) || defs.length >= 16) continue;
        defs.push(tool);
        where.set(tool.exposed, { url, name: tool.name });
      }
    } catch (error) {
      console.error("[mcp]", error instanceof Error ? error.message : "skip");
    }
  }
  if (!defs.length) return null;
  return {
    tools: defs.map((tool) => ({
      type: "function" as const,
      function: { name: tool.exposed, description: tool.description, parameters: tool.schema },
    })),
    invoke: async (exposed, args) => {
      const hit = where.get(exposed);
      if (!hit) return "Инструмент не найден";
      try {
        const url = await publicUrl(hit.url);
        const result = await rpc(url, "tools/call", { name: hit.name, arguments: args && typeof args === "object" ? args : {} }, 3);
        return textOf(result);
      } catch (error) {
        return error instanceof Error ? error.message : "Инструмент не ответил";
      }
    },
  };
}

export async function listPublicTools(raw: string): Promise<{ tools: string[] }> {
  const url = await publicUrl(raw);
  const tools = await toolsOf(url, 0);
  if (!tools.length) throw new Error("Сервер MCP не отдал инструменты");
  return { tools: tools.map((tool) => tool.name) };
}
