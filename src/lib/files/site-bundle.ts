export function siteMime(path: string, fallback: string) {
  const ext = path.split(".").at(-1)?.toLowerCase() ?? "";
  return (
    (
      {
        svg: "image/svg+xml",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        ico: "image/x-icon",
        woff: "font/woff",
        woff2: "font/woff2",
        ttf: "font/ttf",
        otf: "font/otf",
        json: "application/json",
        txt: "text/plain",
        csv: "text/csv",
      } as Record<string, string>
    )[ext] ??
    fallback ??
    "application/octet-stream"
  );
}
export type SiteFile = { path: string; mime: string; bytes: Uint8Array };
const ROOT = "https://vvvion-preview.invalid/";
const text = (file: SiteFile) => new TextDecoder().decode(file.bytes);
function uri(data: Uint8Array, mime: string) {
  let raw = "";
  for (let i = 0; i < data.length; i += 8192)
    raw += String.fromCharCode(...data.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(raw)}`;
}
const textUri = (value: string, mime: string) => uri(new TextEncoder().encode(value), mime);
export function sitePath(value: string, from = "index.html"): string | null {
  try {
    const url = new URL(value, new URL(from, ROOT));
    if (url.origin !== new URL(ROOT).origin) return null;
    const path = decodeURIComponent(url.pathname).slice(1);
    // eslint-disable-next-line no-control-regex -- Intentionally reject or strip control bytes from untrusted text.
    if (path.split("/").some((x) => x === ".." || /[\\\u0000-\u001f]/.test(x))) return null;
    return path;
  } catch {
    return null;
  }
}
export function rewriteSiteImports(
  source: string,
  path: string,
  known: Set<string>,
  missing = new Set<string>(),
) {
  return source.replace(
    /(\bimport\s*\(\s*|\bimport\s+(?:[\w$]+\s*(?:,\s*)?)?(?:\*\s+as\s+[\w$]+\s*|\{[^}]*\}\s*)?from\s*|\bexport\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*|\bimport\s*)(['"])([^'"]+)\2/g,
    (all, lead: string, quote: string, ref: string) => {
      if (!ref.startsWith(".") && !ref.startsWith("/")) return all;
      const target = sitePath(ref, path);
      if (!target || !known.has(target)) {
        missing.add(ref);
        return all;
      }
      return `${lead}${quote}@vvvion/${target}${quote}`;
    },
  );
}

export function folderStyles(paths: string[], entry: string) {
  const dir = entry.includes("/") ? entry.slice(0, entry.lastIndexOf("/") + 1) : "";
  return paths.filter((path) => {
    if (!/\.css$/i.test(path)) return false;
    const fileDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    return fileDir === dir;
  });
}

/** No account URLs enter the sandbox. Assets are inert data URLs loaded by the parent. */
export function buildSite(files: SiteFile[], entry: string) {
  const catalog = new Map(files.map((file) => [file.path, file]));
  if (catalog.size !== files.length)
    throw new Error("В папке есть файлы с одинаковым именем. Переименуйте дубликаты.");
  const missing = new Set<string>();
  const cache = new Map<string, string>();
  const busy = new Set<string>();
  const styled = new Set<string>();
  const pages = files.filter((file) => /\.html?$/i.test(file.path)).map((file) => file.path);
  if (!catalog.has(entry)) throw new Error("Стартовый HTML не найден");
  function asset(ref: string, from: string): string {
    if (/^data:/i.test(ref)) return ref;
    const path = sitePath(ref, from);
    if (!path || !catalog.has(path)) {
      missing.add(ref);
      return "data:,";
    }
    if (cache.has(path)) return cache.get(path)!;
    if (busy.has(path)) {
      missing.add(`Циклический CSS: ${path}`);
      return "data:,";
    }
    busy.add(path);
    const file = catalog.get(path)!;
    let result = "";
    if (/\.css$/i.test(path)) {
      const css = text(file)
        .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_all, _quote, ref: string) =>
          ref.startsWith("#") ? `url("${ref}")` : `url("${asset(ref, path)}")`,
        )
        .replace(
          /@import\s+(['"])([^'"]+)\1/gi,
          (_all, _quote, ref: string) => `@import "${asset(ref, path)}"`,
        );
      result = textUri(css, "text/css;charset=utf-8");
    } else result = uri(file.bytes, siteMime(file.path, file.mime));
    busy.delete(path);
    cache.set(path, result);
    return result;
  }
  function js(source: string, path: string) {
    source = source.replace(
      /new\s+URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g,
      (_all, _quote, ref: string) => `new URL(${JSON.stringify(asset(ref, path))})`,
    );
    return rewriteSiteImports(source, path, new Set(catalog.keys()), missing);
  }
  const cssCache = new Map<string, string>();
  // A sandboxed srcdoc drops <link href="data:text/css">. Inline the text instead.
  function expandStyle(css: string, from: string): string {
    const imported = css.replace(
      /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)[^;]*;?/gi,
      (_all, _q1: string, ref1: string, _q2: string, ref2: string) => {
        const ref = (ref1 || ref2 || "").trim();
        const target = sitePath(ref, from);
        if (!target || !catalog.has(target) || !/\.css$/i.test(target)) {
          missing.add(ref);
          return "";
        }
        if (styled.has(target)) return "";
        styled.add(target);
        return cssText(target);
      },
    );
    return imported.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_all, _quote, ref: string) => {
      const raw = ref.trim();
      if (!raw || raw.startsWith("#") || /^data:/i.test(raw)) return `url("${raw.replace(/"/g, "%22")}")`;
      return `url("${asset(raw, from)}")`;
    });
  }
  function cssText(path: string): string {
    const hit = cssCache.get(path);
    if (hit !== undefined) return hit;
    if (busy.has(path)) {
      missing.add(`Циклический CSS: ${path}`);
      return "";
    }
    const file = catalog.get(path);
    if (!file) return "";
    busy.add(path);
    const css = expandStyle(text(file), path);
    busy.delete(path);
    cssCache.set(path, css);
    return css;
  }

  const imports: Record<string, string> = {};
  for (const file of files)
    if (/\.[mc]?js$/i.test(file.path))
      imports[`@vvvion/${file.path}`] = textUri(
        js(text(file), file.path),
        "text/javascript;charset=utf-8",
      );
  const dom = new DOMParser().parseFromString(text(catalog.get(entry)!), "text/html");
  function adoptStyle(path: string, media: string | null) {
    const style = dom.createElement("style");
    style.setAttribute("data-vvvion-css", path);
    if (media) style.setAttribute("media", media);
    style.textContent = cssText(path).replace(/<\/(style)/gi, "<\\/$1");
    return style;
  }
  dom.querySelectorAll("base,meta[http-equiv]").forEach((node) => node.remove());
  for (const map of dom.querySelectorAll('script[type="importmap"]')) {
    try {
      const data = JSON.parse(map.textContent || "{}");
      for (const [key, value] of Object.entries(data.imports ?? {})) {
        if (typeof value === "string") {
          const path = sitePath(value, entry);
          if (path && imports[`@vvvion/${path}`]) imports[key] = imports[`@vvvion/${path}`];
          else missing.add(String(value));
        }
      }
    } catch {
      missing.add("Некорректный importmap");
    }
    map.remove();
  }
  for (const node of dom.querySelectorAll(
    "link[href],script[src],img[src],source[src],video[src],audio[src],video[poster],input[src]",
  )) {
    const attribute = node.hasAttribute("poster")
      ? "poster"
      : node.hasAttribute("href")
        ? "href"
        : "src";
    const ref = node.getAttribute(attribute)!;
    if (node.tagName === "SCRIPT") {
      const path = sitePath(ref, entry);
      if (path && imports[`@vvvion/${path}`])
        node.setAttribute(attribute, imports[`@vvvion/${path}`]);
      else {
        missing.add(ref);
        node.remove();
      }
      continue;
    }
    const rel = (node.getAttribute("rel") || "").toLowerCase();
    const linked = node.tagName === "LINK" ? sitePath(ref, entry) : null;
    const sheet =
      node.tagName === "LINK" &&
      (/\bstylesheet\b/.test(rel) ||
        (/\bpreload\b/.test(rel) && (node.getAttribute("as") || "").toLowerCase() === "style") ||
        Boolean(linked && /\.css$/i.test(linked)));
    if (sheet) {
      if (linked && catalog.has(linked)) {
        if (styled.has(linked)) node.remove();
        else {
          styled.add(linked);
          node.replaceWith(adoptStyle(linked, node.getAttribute("media")));
        }
      } else {
        missing.add(ref);
        node.remove();
      }
    } else node.setAttribute(attribute, asset(ref, entry));
  }
  for (const node of dom.querySelectorAll("[srcset]")) {
    const srcset = node.getAttribute("srcset") ?? "";
    if (!srcset.startsWith("data:"))
      node.setAttribute(
        "srcset",
        srcset
          .split(",")
          .map((part) => {
            const [ref, ...size] = part.trim().split(/\s+/);
            return `${asset(ref, entry)} ${size.join(" ")}`;
          })
          .join(", "),
      );
  }
  for (const node of dom.querySelectorAll('script:not([src]):not([type="importmap"])'))
    if (!node.getAttribute("type") || node.getAttribute("type") === "module")
      node.textContent = js(node.textContent ?? "", entry);
  for (const node of dom.querySelectorAll("style"))
    if (!node.hasAttribute("data-vvvion-css"))
      node.textContent = expandStyle(node.textContent ?? "", entry).replace(/<\/(style)/gi, "<\\/$1");
  for (const path of folderStyles([...catalog.keys()], entry)) {
    if (styled.has(path) || !dom.head) continue;
    styled.add(path);
    dom.head.append(adoptStyle(path, null));
  }
  for (const node of dom.querySelectorAll("[style]"))
    node.setAttribute(
      "style",
      (node.getAttribute("style") ?? "").replace(
        /url\(\s*(['"]?)(.*?)\1\s*\)/gi,
        (_all, _q, ref: string) => `url("${asset(ref, entry)}")`,
      ),
    );
  const local: Record<string, string> = {};
  for (const file of files)
    if (!/\.html?$/i.test(file.path)) local[file.path] = asset(file.path, entry);
  const config = JSON.stringify({ entry, pages, local, root: ROOT }).replace(/</g, "\\u003c");
  const bootstrap = `(()=>{const c=${config};const nativeFetch=window.fetch.bind(window);const resolve=u=>{try{const url=new URL(u,new URL(c.entry,c.root));return url.origin===new URL(c.root).origin?decodeURIComponent(url.pathname).slice(1):null}catch{return null}};window.fetch=(input,init)=>{const key=resolve(typeof input==='string'?input:input.url);return key&&c.local[key]?nativeFetch(c.local[key],init):Promise.reject(new Error('В предпросмотре доступны только файлы этой папки'))};document.addEventListener('click',event=>{const a=event.target.closest&&event.target.closest('a[href]');if(!a)return;const ref=a.getAttribute('href');event.preventDefault();if(ref.startsWith('#')){document.getElementById(decodeURIComponent(ref.slice(1)))?.scrollIntoView();return}const key=resolve(ref);if(key&&c.pages.includes(key))parent.postMessage({type:'vvvion-site-page',path:key},'*')});document.addEventListener('submit',event=>event.preventDefault());})();`;
  const csp = dom.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content =
    "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data:; connect-src data:; frame-src 'none'; object-src 'none'; base-uri https://vvvion-preview.invalid; form-action 'none'";
  const base = dom.createElement("base");
  base.href = new URL(entry, ROOT).href;
  const map = dom.createElement("script");
  map.type = "importmap";
  map.textContent = JSON.stringify({ imports }).replace(/</g, "\\u003c");
  const boot = dom.createElement("script");
  boot.textContent = bootstrap;
  dom.head.prepend(csp, base, map, boot);
  return {
    html: "<!doctype html>\n" + dom.documentElement.outerHTML,
    missing: [...missing],
    pages,
  };
}
