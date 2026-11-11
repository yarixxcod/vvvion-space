import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { appNotify, initAppBridge, isApp } from "@/lib/app-bridge";
import { destinationFor, parseSitePath, type AppSearch } from "@/lib/app-nav";
import { getBearerToken } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useLang } from "@/lib/lang";
import { getMegaOffer } from "@/lib/social/mega";
import { getPremium } from "@/lib/social/premium";

function authHeaders() {
  const headers = new Headers({ "content-type": "application/json" });
  const token = getBearerToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

function daysLeft(until: string | null) {
  if (!until) return null;
  const ms = new Date(until).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.ceil(ms / 86_400_000);
}

export function AppBridgeHost() {
  const navigate = useNavigate();
  const lang = useLang();
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id ?? null;
  const langRef = useRef(lang);
  const userRef = useRef(userId);
  const reminded = useRef("");
  langRef.current = lang;
  userRef.current = userId;

  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem("vv.lowend") || "0");
      if (stored > 0 && Date.now() - stored < 7 * 86_400_000) document.documentElement.classList.add("vv-lowend");
    } catch {
      /* private mode */
    }
    window.__vvvionNavigate = (path: string) => {
      const dest = destinationFor(path);
      if (dest) {
        const search: AppSearch = langRef.current !== "ru" ? { ...dest.search, lang: langRef.current } : dest.search;
        void navigate({ to: "/", search });
        return;
      }
      const safe = parseSitePath(path);
      if (!safe || safe.startsWith("/api/")) return;
      window.history.pushState({}, "", safe);
      window.dispatchEvent(new PopStateEvent("popstate"));
    };
    initAppBridge(() => Boolean(userRef.current));
    const root = document.documentElement;
    const mode = window.matchMedia("(display-mode: standalone)");
    const markStandalone = () => {
      if (mode.matches) root.classList.add("vv-standalone");
    };
    markStandalone();
    mode.addEventListener("change", markStandalone);
    const applyKb = (open: boolean, height = 0) => {
      root.classList.toggle("vv-kb-open", open);
      const px = open ? `${Math.round(height)}px` : "0px";
      root.style.setProperty("--kb", px);
      root.style.setProperty("--vv-kb", px);
    };
    const onKeyboard = (event: Event) => {
      const detail = (event as CustomEvent<{ open?: boolean; height?: number }>).detail;
      applyKb(Boolean(detail?.open), Number(detail?.height) || 0);
    };
    const viewport = window.visualViewport;
    const onViewport = () => {
      if (!viewport) return;
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      applyKb(inset > 150, inset);
    };
    window.addEventListener("vvvion-app-keyboard", onKeyboard);
    viewport?.addEventListener("resize", onViewport);
    viewport?.addEventListener("scroll", onViewport);
    window.addEventListener("focusin", onViewport);
    return () => {
      mode.removeEventListener("change", markStandalone);
      window.removeEventListener("vvvion-app-keyboard", onKeyboard);
      viewport?.removeEventListener("resize", onViewport);
      viewport?.removeEventListener("scroll", onViewport);
      window.removeEventListener("focusin", onViewport);
    };
  }, [navigate]);

  useEffect(() => {
    initAppBridge(() => Boolean(userId));
    if (!userId || isPending) return;
    if (isApp() && reminded.current !== userId) {
      reminded.current = userId;
      void Promise.all([getPremium().catch(() => null), getMegaOffer().catch(() => null)]).then(([premium, mega]) => {
        const note = (id: string, title: string, until: string | null, url: string) => {
          const days = daysLeft(until);
          if (days == null || days > 3) return;
          const word = days === 1 ? "день" : days < 5 ? "дня" : "дней";
          appNotify({
            id,
            channel: "subs",
            title,
            body: days === 1 ? `${title} закончится завтра` : `Подписка заканчивается через ${days} ${word}`,
            url,
            onlyWhenBackground: false,
          });
        };
        note("sub:premium", "Премиум", premium?.until ?? null, "/c/shop");
        note("sub:mega", "MegaDisk", mega?.until ?? null, "/disk");
      });
    }
    const ping = () => {
      if (document.visibilityState === "hidden") return;
      void fetch("/api/push/seen", { method: "POST", credentials: "same-origin", headers: authHeaders() }).catch(() => undefined);
    };
    ping();
    const timer = window.setInterval(ping, 20_000);
    document.addEventListener("visibilitychange", ping);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", ping);
    };
  }, [userId, isPending]);

  return null;
}
