import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

function stylesLanded() {
  const root = document.body.firstElementChild;
  if (!root) return true;
  return getComputedStyle(root).display === "flex";
}

function sameOriginPath(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth") || url.pathname.startsWith("/__grok/")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

function paintTheme() {
  const light = document.documentElement.classList.contains("light");
  const color = light ? "#f4f1ea" : "#0c0c0e";
  document.documentElement.style.backgroundColor = color;
  document.querySelectorAll('meta[name="theme-color"]').forEach((node) => node.setAttribute("content", color));
}

export function Pwa() {
  const router = useRouter();
  useEffect(() => {
    paintTheme();
    const theme = new MutationObserver(paintTheme);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const heal = () => {
      if (stylesLanded()) return;
      const key = "vvvion.css-recover";
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
      const wipe = async () => {
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((reg) => reg.unregister()));
        }
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.filter((name) => name.startsWith("vvvion-")).map((name) => caches.delete(name)));
        }
      };
      void wipe().finally(() => window.location.reload());
    };
    heal();
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(href)) return;
      const next = sameOriginPath(href);
      if (!next) return;
      const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (next === here) return;
      event.preventDefault();
      event.stopPropagation();
      const go = () => {
        void router.navigate({ href: next });
      };
      go();
    };
    document.addEventListener("click", onClick, true);
    return () => {
      theme.disconnect();
      document.removeEventListener("click", onClick, true);
    };
  }, [router]);
  return null;
}
