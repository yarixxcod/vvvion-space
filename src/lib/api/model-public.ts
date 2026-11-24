const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;

/**
 * Id the public API should advertise.
 * Seed slots such as grok-4.x are not models the owner has.
 * The platform XAI key must not publish them. Only a key stored on the slot counts.
 */
export function publishedChatId(catalogName: string, modelId: string | null | undefined, apiKey: string | null | undefined): string | null {
  const key = (apiKey || "").trim();
  if (!key) return null;
  const upstream = (modelId || "").trim();
  if (upstream && MODEL_RE.test(upstream)) return upstream;
  if (MODEL_RE.test(catalogName)) return catalogName;
  return null;
}

