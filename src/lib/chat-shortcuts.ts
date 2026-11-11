import { useEffect } from "react";
import { closeTopLayer } from "@/lib/app-back";

type Api = {
  stop: () => void;
  streaming: boolean;
  newChat: () => void;
  toggleSidebar: () => void;
  focusSearch: () => void;
  editLast: () => void;
  copyLast: () => void;
  showKeys: () => void;
};

export function useChatShortcuts(api: Api) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      const mod = event.ctrlKey || event.metaKey;
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const composer = target?.id === "composer";
      if (event.key === "Escape") {
        if (closeTopLayer()) {
          event.preventDefault();
          return;
        }
        if (api.streaming) {
          event.preventDefault();
          api.stop();
          return;
        }
        if (composer) target.blur();
        return;
      }
      if (document.documentElement.classList.contains("circle-open")) return;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        api.focusSearch();
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        api.newChat();
        return;
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        api.toggleSidebar();
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        api.copyLast();
        return;
      }
      if (mod && event.key === "/") {
        event.preventDefault();
        api.showKeys();
        return;
      }
      if (event.key === "ArrowUp" && composer && !(target as HTMLTextAreaElement).value && !event.shiftKey && !mod) {
        event.preventDefault();
        api.editLast();
        return;
      }
      if (!typing && !mod && !event.altKey) {
        if (event.key === "/") {
          event.preventDefault();
          document.getElementById("composer")?.focus();
          return;
        }
        if (event.key.length === 1) document.getElementById("composer")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api]);
}

export function modLabel() {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
}
