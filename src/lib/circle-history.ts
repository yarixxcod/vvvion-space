import { useEffect, useRef } from "react";
import { pushBackLayer } from "@/lib/app-back";

let nests = 0;

/** How many history steps leave the circle, including open sub-screens. */
export function circleExitDelta() {
  const marked = typeof history !== "undefined" && Boolean((history.state as { vvCircle?: number } | null)?.vvCircle);
  const steps = nests + (marked ? 1 : 0);
  nests = 0;
  return steps;
}

/** Push one history entry while a circle sub-screen is open. Back closes it. */
export function useCircleNest(active: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active) return;
    let fromPop = false;
    let pushed = false;
    let token = "";
    let off = () => {};
    const timer = window.setTimeout(() => {
      const prev = history.state && typeof history.state === "object" ? history.state : {};
      token = `n${Date.now()}-${nests}`;
      history.pushState({ ...prev, vvCircle: 1, vvNest: token }, "");
      nests += 1;
      pushed = true;
      off = pushBackLayer(() => {
        history.back();
      });
    }, 0);
    const onPop = () => {
      if (!pushed) return;
      const state = history.state as { vvNest?: string } | null;
      if (state?.vvNest === token) return;
      fromPop = true;
      nests = Math.max(0, nests - 1);
      closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("popstate", onPop);
      off();
      if (pushed && !fromPop) {
        const state = history.state as { vvNest?: string } | null;
        if (state?.vvNest === token) {
          nests = Math.max(0, nests - 1);
          history.back();
        }
      }
    };
  }, [active]);
}
