/** Pure Telegram protocol helpers; no credentials or database access. */
export function commandOf(text: string): { name: string; arg: string } | null {
  const match = /^\/([a-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return match ? { name: match[1].toLowerCase(), arg: (match[2] || "").trim() } : null;
}
export function splitTelegramText(text: string, limit = 3500): string[] {
  // eslint-disable-next-line no-control-regex -- Intentionally reject or strip control bytes from untrusted text.
  const clean = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  const parts: string[] = [];
  let rest = clean.slice(0, 28000);
  while (rest.length > limit) {
    let end = rest.lastIndexOf("\n", limit);
    if (end < limit / 2) end = limit;
    // Never split an emoji surrogate pair.
    if (/[\uD800-\uDBFF]/.test(rest[end - 1])) end--;
    parts.push(rest.slice(0, end));
    rest = rest.slice(end).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}
export function privateActor(
  chat: { id?: number | string; type?: string } | undefined,
  from?: { id?: number | string },
): boolean {
  return (
    chat?.type === "private" &&
    /^\d{1,20}$/.test(String(chat.id)) &&
    String(chat.id) === String(from?.id)
  );
}
export function safeBotError(value: unknown): string {
  const text = value instanceof Error ? value.message : "Сервис временно недоступен";
  return text
    .replace(
      /bot\d+:[A-Za-z0-9_-]+|\b\d{5,16}:[A-Za-z0-9_-]{20,90}|(?:sk-|Bearer\s+)[A-Za-z0-9_.-]+/gi,
      "[скрыто]",
    )
    .slice(0, 200);
}
