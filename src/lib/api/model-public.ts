const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;

/** Public IDs identify the catalog model, never a vendor's deployment behind it. */
export function publishedChatId(
  catalogName: string,
  _modelId: string | null | undefined,
  apiKey: string | null | undefined,
): string | null {
  if (!(apiKey || "").trim()) return null;
  return MODEL_RE.test(catalogName) ? catalogName : null;
}

export function resolvePublishedChat(
  models: { id: string; type: string; aliases?: string[] }[],
  requested: string,
): string | null {
  if (!MODEL_RE.test(requested)) return null;
  const direct = models.find((model) => model.type === "chat" && model.id === requested);
  if (direct) return direct.id;
  const matches = models.filter(
    (model) => model.type === "chat" && model.aliases?.includes(requested),
  );
  return matches.length === 1 ? matches[0].id : null;
}
