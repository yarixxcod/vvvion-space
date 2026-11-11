import { appHas } from "@/lib/app-bridge";

export type HapticType = "light" | "medium" | "heavy" | "success" | "warning" | "error" | "selection";

/** One system tap in the Android app. No-op in a browser and while the page is hidden. */
export function haptic(type: HapticType = "light") {
  if (typeof window === "undefined" || typeof document === "undefined" || document.hidden) return;
  if (!/vvvionApp\//.test(navigator.userAgent) || !appHas("haptic")) return;
  if (document.documentElement.classList.contains("vv-reduce-motion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    if (type !== "success" && type !== "error") return;
  }
  try {
    window.VvvionApp?.haptic?.(type);
  } catch {
    /* the shell has gone */
  }
}
