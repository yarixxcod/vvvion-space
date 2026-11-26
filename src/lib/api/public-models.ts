export type PublicModel = { id: string; displayName: string; type: "chat" | "image" };

export const PUBLIC_MODELS_URL = "https://api.vvvion.space/v1/models";

export function parsePublicModels(body: unknown): PublicModel[] {
  const data = body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
    ? (body as { data: unknown[] }).data
    : [];
  const models: PublicModel[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const item = row as { id?: unknown; display_name?: unknown; type?: unknown };
    if (typeof item.id !== "string" || !item.id.trim()) continue;
    const id = item.id.trim();
    const displayName = typeof item.display_name === "string" && item.display_name.trim() ? item.display_name.trim() : id;
    models.push({ id, displayName, type: item.type === "image" ? "image" : "chat" });
  }
  return models;
}

export async function loadPublicModels(): Promise<PublicModel[]> {
  const urls = [PUBLIC_MODELS_URL, "/v1/models"];
  let last: unknown;
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" }, credentials: "omit" });
      if (!response.ok) throw new Error(String(response.status));
      return parsePublicModels(await response.json());
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error("models");
}
