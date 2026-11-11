const KEY = "vvvion.jump";

export type Jump = { book?: string; post?: string };

export function rememberJump(jump: Jump) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(jump));
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event("vvvion-jump"));
}

export function readJump(): Jump | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Jump;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearJump() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
