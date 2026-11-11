export const GUEST_OWNER = "guest";

export type LocalChatAccess = "keep" | "adopt" | "drop";

/**
 * Local chat copies are tagged with who wrote them.
 * `keep` — same person, show them.
 * `adopt` — anonymous drafts on this browser, attach them to the account that just signed in.
 * `drop` — another account, a signed-out visitor, or an untagged leftover. Never show or upload.
 */
export function localChatAccess(owner: string | null, userId: string | null): LocalChatAccess {
  const mark = owner?.trim() ? owner : null;
  const id = userId?.trim() ? userId : null;
  if (id) {
    if (mark === id) return "keep";
    if (mark === GUEST_OWNER) return "adopt";
    return "drop";
  }
  return mark === GUEST_OWNER ? "keep" : "drop";
}
