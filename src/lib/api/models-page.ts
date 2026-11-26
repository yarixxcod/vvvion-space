export type CatalogCard = {
  id: string;
  displayName: string;
  type: "chat" | "image";
};

export const MODELS_PAGE_SIZE = 12;

export function wantsModelsHtml(headers: {
  accept?: string | null;
  authorization?: string | null;
  apiKey?: string | null;
}): boolean {
  const accept = (headers.accept || "").toLowerCase();
  if (!accept.includes("text/html")) return false;
  if ((headers.authorization || "").trim()) return false;
  if ((headers.apiKey || "").trim()) return false;
  return true;
}

export function parseModelsQuery(search: URLSearchParams): {
  limit: number | null;
  after: string;
  page: number;
  type: "all" | "chat" | "image";
} {
  const rawLimit = search.get("limit");
  let limit: number | null = null;
  if (rawLimit != null && rawLimit !== "") {
    const n = Number(rawLimit);
    if (Number.isInteger(n) && n > 0) limit = Math.min(100, n);
  }
  const rawPage = Number(search.get("page") || "1");
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const kind = search.get("type");
  return {
    limit,
    after: (search.get("after") || search.get("after_id") || "").trim().slice(0, 80),
    page,
    type: kind === "chat" || kind === "image" ? kind : "all",
  };
}

export function sliceByCursor<T extends { id: string }>(
  models: T[],
  limit: number | null,
  after: string,
): { data: T[]; hasMore: boolean } {
  let start = 0;
  if (after) {
    const index = models.findIndex((model) => model.id === after);
    start = index >= 0 ? index + 1 : models.length;
  }
  if (limit == null) return { data: models.slice(start), hasMore: false };
  return { data: models.slice(start, start + limit), hasMore: start + limit < models.length };
}

export function catalogWindow(models: CatalogCard[], page: number, type: "all" | "chat" | "image", size = MODELS_PAGE_SIZE) {
  const filtered = type === "all" ? models : models.filter((model) => model.type === type);
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.min(pages, Math.max(1, page));
  const start = (current - 1) * size;
  return {
    type,
    page: current,
    pages,
    total: filtered.length,
    chats: models.filter((model) => model.type === "chat").length,
    images: models.filter((model) => model.type === "image").length,
    items: filtered.slice(start, start + size),
  };
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "\u0026amp;";
    if (ch === "<") return "\u0026lt;";
    if (ch === ">") return "\u0026gt;";
    if (ch === '"') return "\u0026quot;";
    return "\u0026#39;";
  });
}

function href(type: "all" | "chat" | "image", page: number): string {
  const query = new URLSearchParams();
  if (type !== "all") query.set("type", type);
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `/v1/models?${text}` : "/v1/models";
}

function chip(label: string, count: number, active: boolean, type: "all" | "chat" | "image"): string {
  const cls = active ? "chip on" : "chip";
  return `<a class="${cls}" href="${href(type, 1)}">${esc(label)} <span>${count}</span></a>`;
}

function cards(items: CatalogCard[], type: "chat" | "image"): string {
  const rows = items.filter((item) => item.type === type);
  if (!rows.length) return "";
  const title = type === "chat" ? "Чат" : "Картинки";
  const body = rows
    .map((item) => {
      const kind = type === "chat" ? "чат" : "картинка";
      return `<article class="card">
        <div class="card-top"><span class="kind">${kind}</span><button type="button" class="copy" data-copy="${esc(item.id)}">копировать</button></div>
        <h3>${esc(item.displayName)}</h3>
        <code>${esc(item.id)}</code>
      </article>`;
    })
    .join("");
  return `<section><h2>${title}</h2><div class="grid">${body}</div></section>`;
}

export function renderModelsPage(models: CatalogCard[], page: number, type: "all" | "chat" | "image"): string {
  const view = catalogWindow(models, page, type);
  const sections = `${cards(view.items, "chat")}${cards(view.items, "image")}`;
  const empty = view.total
    ? sections
    : `<p class="empty">${view.chats + view.images ? "В этом разделе пусто." : "Пока нет моделей, открытых для API."}</p>`;
  const prev = view.page > 1 ? `<a href="${href(view.type, view.page - 1)}">Назад</a>` : `<span class="off">Назад</span>`;
  const next = view.page < view.pages ? `<a href="${href(view.type, view.page + 1)}">Дальше</a>` : `<span class="off">Дальше</span>`;
  const pager = view.pages > 1 ? `<nav class="pager" aria-label="Страницы">${prev}<span>${view.page} из ${view.pages}</span>${next}</nav>` : "";
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Модели · VVVion API</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: #f4f2ee; background:
    radial-gradient(900px 420px at 8% -10%, #a892d640, transparent 60%),
    radial-gradient(700px 380px at 100% 0%, #7896c433, transparent 55%),
    #0c0c0e;
    font: 16px/1.45 ui-sans-serif, system-ui, sans-serif; }
  .wrap { width: min(980px, calc(100% - 32px)); margin: 0 auto; padding: 40px 0 72px; }
  .brand { letter-spacing: .22em; text-transform: uppercase; color: #9a958c; font-size: 12px; }
  .brand b { color: #c4b5e8; font-weight: 600; letter-spacing: .14em; }
  h1 { margin: 14px 0 8px; font-family: ui-serif, Georgia, serif; font-size: clamp(40px, 6vw, 64px); font-weight: 460; letter-spacing: -.04em; }
  .lead { max-width: 62ch; margin: 0; color: #b0ada6; }
  .lead code, .meta code, .card code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .lead code { color: #f4f2ee; }
  .meta { margin: 18px 0 0; }
  .meta code { display: inline-block; padding: 8px 12px; border: 1px solid #2e2e34; border-radius: 999px; background: #141417; color: #c4b5e8; }
  .filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 22px 0 8px; }
  .chip { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 14px; border: 1px solid #2e2e34; border-radius: 999px; color: #b0ada6; text-decoration: none; background: #141417; }
  .chip span { color: #9a958c; font-variant-numeric: tabular-nums; }
  .chip.on { color: #1b1526; background: #c4b5e8; border-color: #c4b5e8; }
  .chip.on span { color: #1b1526; }
  section { margin-top: 28px; }
  h2 { margin: 0 0 12px; color: #9a958c; font-size: 12px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; }
  .grid { display: grid; gap: 12px; }
  @media (min-width: 760px) { .grid { grid-template-columns: 1fr 1fr; } }
  .card { padding: 16px 16px 14px; border: 1px solid #2e2e34; border-radius: 22px; background: linear-gradient(160deg, #17171b, #101013 70%); }
  .card-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .kind { color: #9a958c; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
  .copy { min-height: 36px; padding: 0 12px; border: 1px solid #2e2e34; border-radius: 999px; color: #f4f2ee; background: #1c1c21; cursor: pointer; }
  .copy.on { color: #1b1526; background: #c4b5e8; border-color: #c4b5e8; }
  h3 { margin: 12px 0 8px; font-size: 22px; font-weight: 560; letter-spacing: -.02em; }
  .card code { display: block; overflow-wrap: anywhere; color: #c4b5e8; font-size: 14px; }
  .pager { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 28px; }
  .pager a, .pager span { min-width: 88px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; }
  .pager a { color: #f4f2ee; text-decoration: none; border: 1px solid #2e2e34; border-radius: 14px; background: #141417; }
  .off { color: #63636c; }
  .empty { margin-top: 28px; color: #b0ada6; }
  footer { margin-top: 36px; color: #9a958c; font-size: 13px; }
  footer code { color: #b0ada6; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <p class="brand">VVVion <b>API</b></p>
      <h1>Модели</h1>
      <p class="lead">В запросе указывайте <code>id</code>. Название становится им само: DeepSeek-4.1 Flash → <code>deepseek-4.1-flash</code>.</p>
      <p class="meta"><code>https://api.vvvion.space/v1</code></p>
      <nav class="filters" aria-label="Разделы">
        ${chip("Все", view.chats + view.images, view.type === "all", "all")}
        ${chip("Чат", view.chats, view.type === "chat", "chat")}
        ${chip("Картинки", view.images, view.type === "image", "image")}
      </nav>
    </header>
    <main>${empty}</main>
    ${pager}
    <footer>Клиенты с ключом получают JSON на этом же адресе. Страницы: <code>?limit=20\u0026amp;after=id</code>. На странице по ${MODELS_PAGE_SIZE}.</footer>
  </div>
  <script>
    document.querySelectorAll("[data-copy]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var value = btn.getAttribute("data-copy") || "";
        var done = function () {
          btn.classList.add("on");
          btn.textContent = "скопировано";
          setTimeout(function () { btn.classList.remove("on"); btn.textContent = "копировать"; }, 1100);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value).then(done).catch(function () {});
      });
    });
  </script>
</body>
</html>`;
}

export function renderModelsError(): string {
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Модели · VVVion API</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0c0c0e;color:#f4f2ee;font:16px ui-sans-serif,system-ui"><p>Список моделей сейчас недоступен.</p></body></html>`;
}
