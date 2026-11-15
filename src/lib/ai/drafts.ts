type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function draftKey(owner: string | null, chat: string | null) {
  return `vv-draft-v1:${encodeURIComponent(owner || "guest")}:${encodeURIComponent(chat || "new")}`;
}
export function readDraft(
  owner: string | null,
  chat: string | null,
  storage?: StorageLike,
): string {
  try {
    return ((storage ?? localStorage).getItem(draftKey(owner, chat)) || "").slice(0, 48000);
  } catch {
    return "";
  }
}
export function writeDraft(
  owner: string | null,
  chat: string | null,
  text: string,
  storage?: StorageLike,
): boolean {
  try {
    const target = storage ?? localStorage;
    if (text) target.setItem(draftKey(owner, chat), text.slice(0, 48000));
    else target.removeItem(draftKey(owner, chat));
    return true;
  } catch {
    return false;
  }
}
