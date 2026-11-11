import { useRef } from "react";
import { haptic } from "@/lib/haptic";

export function useLongPress(onFire: () => void, ms = 450) {
  const timer = useRef(0);
  const x = useRef(0);
  const y = useRef(0);
  const fired = useRef(false);
  function clear() {
    window.clearTimeout(timer.current);
    timer.current = 0;
  }
  return {
    fired,
    onPointerDown(event: React.PointerEvent) {
      if (event.pointerType === "mouse") return;
      fired.current = false;
      x.current = event.clientX;
      y.current = event.clientY;
      clear();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        haptic("heavy");
        onFire();
      }, ms);
    },
    onPointerMove(event: React.PointerEvent) {
      if (Math.hypot(event.clientX - x.current, event.clientY - y.current) > 10) clear();
    },
    onPointerUp() {
      clear();
    },
    onPointerCancel() {
      clear();
    },
    onContextMenu(event: React.MouseEvent) {
      if (fired.current) event.preventDefault();
    },
  };
}
