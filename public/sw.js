const CACHE = "vvvion-shell-5";
const SHELL = ["/offline.html", "/favicon.svg", "/favicon.ico", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"];
const PUBLIC_PAGES = new Set(["/", "/about", "/updates", "/login", "/offline.html"]);

function isPublicPage(pathname) {
  if (PUBLIC_PAGES.has(pathname)) return true;
  return /^\/c\/(messages|feed|play|services|disk|bank|shop)$/.test(pathname);
}

function isHtml(response) {
  const type = response.headers.get("content-type") || "";
  return type.includes("text/html");
}

function isAsset(url, request) {
  if (!url.pathname.startsWith("/assets/")) return false;
  const dest = request.destination;
  return dest === "script" || dest === "style" || dest === "font" || dest === "image" || dest === "";
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "clear") return;
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("vvvion-")).map((key) => caches.delete(key)))),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_server") || url.pathname.startsWith("/auth")) return;

  if (isAsset(url, request)) {
    event.respondWith(assetFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    if (!isPublicPage(url.pathname)) return;
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200 && response.type === "basic" && isHtml(response)) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match("/offline.html")) || Response.error()),
    );
    return;
  }

  if (!SHELL.includes(url.pathname)) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.status === 200 && response.type === "basic" && !isHtml(response)) void cache.put(request, response.clone());
          return response;
        })
        .catch(() => hit || Response.error());
      return hit || network;
    }),
  );
});

async function assetFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit && !isHtml(hit)) return hit;
  try {
    const response = await fetch(request);
    if (response.status === 200 && response.type === "basic" && !isHtml(response)) {
      void cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    if (hit) return hit;
    throw error;
  }
}
