import { useLayoutEffect, useRef } from "react";

const sectionPositions = new Map<string, number[]>();

/** Restore after async content grows; stop restoring as soon as the visitor interacts. */
export function useSectionScroll(section: string, owner: string) {
  const ref = useRef<HTMLDivElement>(null);
  const positions = useRef(sectionPositions);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const key = `${owner}:${section}`;
    const saved = positions.current.get(key);
    const nodes = () =>
      Array.from(root.querySelectorAll<HTMLElement>(".overflow-y-auto, [data-scroll]"));
    let touched = false;
    const restore = () => {
      if (touched || !saved) return;
      nodes().forEach((node, index) => {
        if (saved[index] != null) node.scrollTop = saved[index];
      });
    };
    const stop = () => {
      touched = true;
      observer.disconnect();
    };
    const observer = new ResizeObserver(restore);
    observer.observe(root);
    for (const node of Array.from(root.children)) observer.observe(node);
    const mutation = new MutationObserver(() => {
      restore();
      nodes().forEach((node) => {
        observer.observe(node);
        if (node.firstElementChild) observer.observe(node.firstElementChild);
      });
    });
    mutation.observe(root, { childList: true, subtree: true });
    const remember = () => {
      if (positions.current.size > 100)
        positions.current.delete(positions.current.keys().next().value!);
      if (touched || !saved)
        positions.current.set(
          key,
          nodes().map((node) => node.scrollTop),
        );
    };
    root.addEventListener("scroll", remember, true);
    restore();
    root.addEventListener("touchstart", stop, { passive: true });
    root.addEventListener("wheel", stop, { passive: true });
    root.addEventListener("pointerdown", stop);
    root.addEventListener("keydown", stop);
    const timer = window.setTimeout(() => {
      observer.disconnect();
      mutation.disconnect();
    }, 10000);
    return () => {
      root.removeEventListener("scroll", remember, true);
      clearTimeout(timer);
      observer.disconnect();
      mutation.disconnect();
      root.removeEventListener("touchstart", stop);
      root.removeEventListener("wheel", stop);
      root.removeEventListener("pointerdown", stop);
      root.removeEventListener("keydown", stop);
    };
  }, [section, owner]);
  return ref;
}
