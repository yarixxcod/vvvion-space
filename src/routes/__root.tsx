import { createRootRoute, HeadContent, Outlet, Scripts, useRouterState } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { Pwa } from "@/components/yaronetic/pwa";
import { AppBridgeHost } from "@/components/yaronetic/app-bridge-host";
import { PullRefresh } from "@/components/yaronetic/pull-refresh";
import { NotFoundPage } from "@/lib/error-component";
import { explicitLangFromSearch, LANGS, type Lang } from "@/lib/i18n";
import { LangProvider } from "@/lib/lang";
import { localeOf } from "@/lib/seo";
import appCss from "../styles.css?url";

const themeBoot = `try{if(localStorage.getItem("yaronetic.theme")==="light")document.documentElement.classList.add("light")}catch(e){}try{document.documentElement.style.backgroundColor=document.documentElement.classList.contains("light")?"#f4f2ee":"#0c0c0e";var tm=document.querySelector('meta[name="theme-color"]');if(tm)tm.setAttribute("content",document.documentElement.classList.contains("light")?"#f4f1ea":"#0c0c0e")}catch(e){}try{var p=localStorage.getItem("yaronetic.paper");if(p==="dots")p="warm";if(p==="hatch")p="edge";if(p==="warm"||p==="edge"||p==="mesh")document.documentElement.dataset.paper=p}catch(e){}try{var h=window.__REACT_DEVTOOLS_GLOBAL_HOOK__;if(h){if(!h.renderers||typeof h.renderers.forEach!="function")h.renderers=new Map();if(typeof h.inject!="function")h.inject=function(){return 0};if(typeof h.onCommitFiberRoot!="function")h.onCommitFiberRoot=function(){};if(typeof h.onCommitFiberUnmount!="function")h.onCommitFiberUnmount=function(){}}}catch(e){}`;

export const Route = createRootRoute({
  notFoundComponent: NotFoundPage,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" },
      { name: "theme-color", content: "#0c0c0e" },
      { name: "application-name", content: "vvvion.space" },
      { name: "apple-mobile-web-app-title", content: "vvvion" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "format-detection", content: "telephone=no" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&family=Outfit:wght@400;500;600&family=Syne:wght@700;800&family=Onest:wght@400;500;600&family=Playfair+Display:wght@400;500&display=swap",
      },
    ],
  }),
  component: RootDocument,
});

function RootDocument() {
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const lang = explicitLangFromSearch(searchStr) ?? "ru";
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <HeadContent />
        {(LANGS.filter((code) => code !== lang) as Lang[]).map((code) => (
          <meta key={code} property="og:locale:alternate" content={localeOf(code)} />
        ))}
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>
        <PreviewHostBridge />
        <Pwa />
        <LangProvider>
          <AuthProvider>
            <AppBridgeHost />
            <PullRefresh>
              <Outlet />
            </PullRefresh>
          </AuthProvider>
        </LangProvider>
        <Scripts />
      </body>
    </html>
  );
}
