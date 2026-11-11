import { useRef } from "react";

type Opts = {
  startPx?: number;
  commit?: (dx: number, v: number) => boolean;
  onMove?: (dx: number) => void;
  onCommit?: (dir: 1 | -1) => void;
  onCancel?: () => void;
  enabled: boolean;
  ignore?: string;
  /** Ignore presses that start left of this clientX (system back edge). */
  minX?: number;
};

export function useSwipe(options: Opts) {
  const state = useRef({ x: 0, y: 0, t: 0, id: -1, locked: false, dead: false });
  const ignore = options.ignore ?? ".scroll-x,pre,.code-frame,.katex-display,input,textarea,[data-no-swipe]";
  const start = options.startPx ?? 12;
  return {
    style: { touchAction: "pan-y" } as const,
    onPointerDown(event: React.PointerEvent) {
      if (!options.enabled || event.pointerType === "mouse" || !event.isPrimary) return;
      if (options.minX != null && event.clientX < options.minX) return;
      if ((event.target as Element).closest(ignore)) {
        state.current.dead = true;
        return;
      }
      state.current = { x: event.clientX, y: event.clientY, t: performance.now(), id: event.pointerId, locked: false, dead: false };
    },
    onPointerMove(event: React.PointerEvent) {
      const current = state.current;
      if (current.dead || event.pointerId !== current.id) return;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (!current.locked) {
        if (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx)) {
          current.dead = true;
          return;
        }
        if (Math.abs(dx) < start || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
        current.locked = true;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      }
      options.onMove?.(dx);
    },
    onPointerUp(event: React.PointerEvent) {
      const current = state.current;
      if (!current.locked || current.dead) {
        current.dead = false;
        return;
      }
      const dx = event.clientX - current.x;
      const velocity = dx / Math.max(1, performance.now() - current.t);
      current.locked = false;
      if (options.commit ? options.commit(dx, velocity) : false) options.onCommit?.(dx > 0 ? 1 : -1);
      else options.onCancel?.();
    },
    onPointerCancel() {
      const current = state.current;
      if (current.locked) options.onCancel?.();
      current.locked = false;
      current.dead = false;
    },
  };
}
