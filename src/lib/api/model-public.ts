const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;

/**
 * Id the public API should advertise.
 * A catalog slot name (the old grok-4.x seeds) is not a model the owner has.
 * Publish the provider model id when it is set, otherwise the slot name only
 * if that slot has its own key.
 */
export function publishedChatId(catalogName: string, modelId: string | null | undefined, apiKey: string | null | undefined): string | null {
  const upstream = (modelId || "").trim();
  const key = (apiKey || "").trim();
  if (upstream && MODEL_RE.test(upstream)) return upstream;
  if (key && MODEL_RE.test(catalogName)) return catalogName;
  return null;
}
