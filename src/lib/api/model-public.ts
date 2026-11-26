const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;

/** DeepSeek-4.1 Flash → deepseek-4.1-flash. Vendor ids are never the public name. */
export function apiModelSlug(label: string): string | null {
  const folded = label.normalize("NFKD").replace(/\p{M}+/gu, "");
  const slug = folded
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 64)
    .replace(/^[-.]+|[-.]+$/g, "");
  if (!slug || !MODEL_RE.test(slug)) return null;
  return slug;
}

function publicModelId(displayName: string, catalogName: string): string | null {
  return apiModelSlug(displayName) || (MODEL_RE.test(catalogName) ? catalogName : null);
}

/** Public request id is a slug of the display name, once an owner key exists. */
export function publishedChatId(
  displayName: string,
  catalogName: string,
  apiKey: string | null | undefined,
): string | null {
  if (!(apiKey || "").trim()) return null;
  return publicModelId(displayName, catalogName);
}

/** Keep slugs unique. A free catalog slug wins over a numeric suffix. */
export function uniquePublicId(displayName: string, catalogName: string, taken: Set<string>): string | null {
  const root = publicModelId(displayName, catalogName);
  if (!root) return null;
  if (!taken.has(root)) return root;
  const tail = apiModelSlug(catalogName);
  if (tail && tail !== root && !taken.has(tail)) return tail;
  const stem = tail && tail !== root ? `${root}-${tail}` : root;
  const mixed = stem.replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 64);
  if (mixed && !taken.has(mixed) && MODEL_RE.test(mixed)) return mixed;
  for (let n = 2; n < 100; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${root.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`.replace(/^[-.]+|[-.]+$/g, "");
    if (candidate && !taken.has(candidate) && MODEL_RE.test(candidate)) return candidate;
  }
  return null;
}

export type PublicRef = {
  id: string;
  catalog?: string;
  type: string;
  aliases?: string[];
};

/** Returns the internal catalog name, never the public slug. */
export function resolvePublishedChat(models: PublicRef[], requested: string): string | null {
  if (!MODEL_RE.test(requested)) return null;
  const chats = models.filter((model) => model.type === "chat");
  const direct = chats.find((model) => model.id === requested || model.catalog === requested);
  if (direct) return direct.catalog || direct.id;
  const matches = chats.filter((model) => model.aliases?.includes(requested));
  if (matches.length !== 1) return null;
  return matches[0].catalog || matches[0].id;
}
