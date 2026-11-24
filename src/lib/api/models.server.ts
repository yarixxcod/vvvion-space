import { getSql } from "@/lib/db";
import { publishedChatId } from "@/lib/api/model-public";

const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;

export type ApiModel = { id: string; created: number; type: "chat" | "image"; displayName: string; aliases?: string[] };

function xaiHost(value: string | null | undefined): boolean {
  const host = (value || "").trim();
  if (!host) return true;
  try {
    const name = new URL(host.startsWith("http") ? host : `https://${host}`).hostname;
    return name === "api.x.ai" || name.endsWith(".x.ai");
  } catch {
    return false;
  }
}

function usable(baseUrl: string | null | undefined, apiKey: string | null | undefined, xaiReady: boolean): boolean {
  if ((apiKey || "").trim()) return true;
  return xaiReady && xaiHost(baseUrl);
}

export async function listApiModels(): Promise<ApiModel[]> {
  const sql = await getSql();
  const xaiReady = Boolean(process.env.XAI_API_KEY?.trim());
  const chats = await sql<{ name: string; display_name: string | null; created: number; base_url: string | null; api_key: string | null; api_enabled: boolean }>`
    select name, display_name, extract(epoch from created_at)::int as created, base_url, api_key, api_enabled
    from catalog_models where api_enabled = true order by created_at asc, name asc
  `;
  const links = await sql<{ model_name: string; base_url: string | null; api_key: string | null; model_id: string | null }>`
    select model_name, base_url, api_key, model_id from catalog_providers
  `;
  const byName = new Map<string, { baseUrl: string | null; apiKey: string | null; modelId: string | null }[]>();
  for (const link of links) {
    const list = byName.get(link.model_name) ?? [];
    list.push({ baseUrl: link.base_url, apiKey: link.api_key, modelId: link.model_id });
    byName.set(link.model_name, list);
  }
  const visible: ApiModel[] = [];
  const seen = new Set<string>();
  for (const row of chats) {
    if (!MODEL_RE.test(row.name)) continue;
    const stored = byName.get(row.name);
    const list = stored?.length ? stored : [{ baseUrl: row.base_url, apiKey: row.api_key, modelId: null }];
    for (const item of list) {
      if (!usable(item.baseUrl, item.apiKey, xaiReady)) continue;
      const id = publishedChatId(row.name, item.modelId, item.apiKey);
      if (!id || seen.has(`chat:${id}`)) continue;
      seen.add(`chat:${id}`);
      visible.push({
        id,
        created: Number(row.created) || 0,
        type: "chat",
        displayName: row.display_name || id,
        aliases: id === row.name ? [] : [row.name],
      });
    }
  }
  const images = await sql<{ name: string; display_name: string | null; created: number; base_url: string | null; api_key: string | null }>`
    select name, display_name, extract(epoch from created_at)::int as created, base_url, api_key
    from image_models where api_enabled = true order by created_at asc, name asc
  `;
  for (const row of images) {
    if (!MODEL_RE.test(row.name)) continue;
    if (!usable(row.base_url, row.api_key, xaiReady)) continue;
    visible.push({ id: row.name, created: Number(row.created) || 0, type: "image", displayName: row.display_name || row.name });
  }
  return visible;
}

export async function chatModelAllowed(name: string): Promise<boolean> {
  if (!MODEL_RE.test(name)) return false;
  const models = await listApiModels();
  return models.some((model) => model.type === "chat" && (model.id === name || model.aliases?.includes(name)));
}

export async function imageModelRow(name: string): Promise<{ name: string; baseUrl: string; apiKey: string; requestConfig: Record<string, unknown> } | null> {
  if (!MODEL_RE.test(name)) return null;
  const sql = await getSql();
  const rows = await sql<{ name: string; base_url: string | null; api_key: string | null; request_config: unknown; api_enabled: boolean }>`
    select name, base_url, api_key, request_config, api_enabled from image_models where name = ${name} limit 1
  `;
  const row = rows[0];
  if (!row || row.api_enabled === false) return null;
  const xaiReady = Boolean(process.env.XAI_API_KEY?.trim());
  const baseUrl = row.base_url?.trim() || "https://api.x.ai/v1";
  const apiKey = row.api_key?.trim() || (xaiHost(baseUrl) && xaiReady ? process.env.XAI_API_KEY || "" : "");
  if (!apiKey) return null;
  let requestConfig: Record<string, unknown> = {};
  if (row.request_config && typeof row.request_config === "object" && !Array.isArray(row.request_config)) requestConfig = row.request_config as Record<string, unknown>;
  else if (typeof row.request_config === "string") {
    try {
      const parsed = JSON.parse(row.request_config) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) requestConfig = parsed as Record<string, unknown>;
    } catch { /* пустой конфиг */ }
  }
  return { name: row.name, baseUrl, apiKey, requestConfig };
}
