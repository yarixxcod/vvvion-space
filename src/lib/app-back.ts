import { useEffect, useState } from "react";

const layers: Array<() => void> = [];

export function pushBackLayer(close: () => void) {
  layers.push(close);
  return () => {
    const index = layers.lastIndexOf(close);
    if (index >= 0) layers.splice(index, 1);
  };
}

export function closeTopLayer() {
  const close = layers.pop();
  if (!close) return false;
  close();
  return true;
}

if (typeof window !== "undefined") {
  window.__vvvionHandleBack = () => closeTopLayer();
  window.__vvvionBackOwned = true;
}

declare global {
  interface Window {
    __vvvionHandleBack?: () => boolean;
    __vvvionBackOwned?: boolean;
  }
}

export function gestureSurface() {
  if (typeof document === "undefined") return false;
  const root = document.documentElement;
  return root.classList.contains("vv-app") || root.classList.contains("vv-standalone");
}

export function useGestureSurface() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setOn(root.classList.contains("vv-app") || root.classList.contains("vv-standalone"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    const media = window.matchMedia("(display-mode: standalone)");
    const onMode = () => {
      if (media.matches) root.classList.add("vv-standalone");
      read();
    };
    onMode();
    media.addEventListener("change", onMode);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", onMode);
    };
  }, []);
  return on;
}
