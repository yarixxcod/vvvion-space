import { useRef } from "react";
import { useGestureSurface } from "@/lib/app-back";
import { haptic } from "@/lib/haptic";
import { useSwipe } from "@/lib/gestures/use-swipe";

/** Swipe right from x ≥ 24 closes a circle sub-screen. Ignored in a normal browser tab. */
export function useEdgeBack(active: boolean, onBack: () => void) {
  const surface = useGestureSurface();
  const backRef = useRef(onBack);
  backRef.current = onBack;
  return useSwipe({
    enabled: active && surface,
    minX: 24,
    ignore: ".snap-row,.scroll-x,pre,.code-frame,[data-no-swipe],input,textarea,video,iframe,.circle-nav",
    commit: (dx, velocity) => dx > window.innerWidth * 0.35 || velocity > 0.5,
    onCommit(dir) {
      if (dir !== 1) return;
      haptic("light");
      backRef.current();
    },
  });
}
