import { useEffect, useState, type ReactNode } from "react";
import { isApp } from "@/lib/app-bridge";

export function PullRefresh({ children }: { children: ReactNode }) {
  const [gen, setGen] = useState(0);

  useEffect(() => {
    if (isApp()) return;
    let startY = 0;
    let startX = 0;
    let armed = false;
    let t0 = 0;
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      armed = window.scrollY <= 2 && !(event.target instanceof Element && event.target.closest("[data-scroll], textarea, input"));
      startY = touch.clientY;
      startX = touch.clientX;
      t0 = performance.now();
    };
    const onEnd = (event: TouchEvent) => {
      if (!armed) return;
      armed = false;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dy = touch.clientY - startY;
      const dx = Math.abs(touch.clientX - startX);
      if (dx > 24) return;
      if (dy > 140 && performance.now() - t0 > 220) setGen((value) => value + 1);
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  return (
    <div key={gen} className="flex min-h-dvh w-full flex-col">
      {children}
    </div>
  );
}
