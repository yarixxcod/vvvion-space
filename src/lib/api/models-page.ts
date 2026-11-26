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

export function renderModelsShell(): string {
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
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <p class="brand">VVVion <b>API</b></p>
      <h1>Модели</h1>
      <p class="lead">Список читается с <code>https://api.vvvion.space/v1/models</code>. В запросе указывайте <code>id</code>.</p>
      <p class="meta"><code>https://api.vvvion.space/v1</code></p>
      <nav id="filters" class="filters" aria-label="Разделы"></nav>
    </header>
    <main id="list"><p class="empty">Загружаю модели…</p></main>
    <div id="pager"></div>
    <footer>Страницы по ${MODELS_PAGE_SIZE}. Клиенты с ключом получают тот же JSON.</footer>
  </div>
  <script>
    (function () {
      var PAGE = ${MODELS_PAGE_SIZE};
      var root = document.getElementById("list");
      var filters = document.getElementById("filters");
      var pager = document.getElementById("pager");
      var params = new URLSearchParams(location.search);
      var page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
      var kind = params.get("type") === "chat" || params.get("type") === "image" ? params.get("type") : "all";
      function link(type, nextPage) {
        var query = new URLSearchParams();
        if (type !== "all") query.set("type", type);
        if (nextPage > 1) query.set("page", String(nextPage));
        var text = query.toString();
        return text ? "/v1/models?" + text : "/v1/models";
      }
      function render(models) {
        var filtered = models.filter(function (model) { return kind === "all" || model.type === kind; });
        var pages = Math.max(1, Math.ceil(filtered.length / PAGE) || 1);
        var current = Math.min(pages, page);
        var slice = filtered.slice((current - 1) * PAGE, current * PAGE);
        var chats = models.filter(function (model) { return model.type === "chat"; }).length;
        filters.textContent = "";
        [["all", "Все", models.length], ["chat", "Чат", chats], ["image", "Картинки", models.length - chats]].forEach(function (item) {
          var anchor = document.createElement("a");
          anchor.className = item[0] === kind ? "chip on" : "chip";
          anchor.href = link(item[0], 1);
          anchor.append(document.createTextNode(item[1] + " "));
          var count = document.createElement("span");
          count.textContent = String(item[2]);
          anchor.append(count);
          filters.append(anchor);
        });
        root.textContent = "";
        if (!slice.length) {
          var empty = document.createElement("p");
          empty.className = "empty";
          empty.textContent = models.length ? "В этом разделе пусто." : "Пока нет моделей, открытых для API.";
          root.append(empty);
          return;
        }
        ["chat", "image"].forEach(function (type) {
          var rows = slice.filter(function (model) { return model.type === type; });
          if (!rows.length) return;
          var section = document.createElement("section");
          var heading = document.createElement("h2");
          heading.textContent = type === "chat" ? "Чат" : "Картинки";
          var grid = document.createElement("div");
          grid.className = "grid";
          rows.forEach(function (model) {
            var card = document.createElement("article");
            card.className = "card";
            var top = document.createElement("div");
            top.className = "card-top";
            var badge = document.createElement("span");
            badge.className = "kind";
            badge.textContent = type === "chat" ? "чат" : "картинка";
            var button = document.createElement("button");
            button.type = "button";
            button.className = "copy";
            button.textContent = "копировать";
            button.addEventListener("click", function () {
              if (!navigator.clipboard) return;
              navigator.clipboard.writeText(model.id).then(function () {
                button.classList.add("on");
                button.textContent = "скопировано";
                setTimeout(function () { button.classList.remove("on"); button.textContent = "копировать"; }, 1100);
              }).catch(function () {});
            });
            top.append(badge, button);
            var title = document.createElement("h3");
            title.textContent = model.name;
            var code = document.createElement("code");
            code.textContent = model.id;
            card.append(top, title, code);
            grid.append(card);
          });
          section.append(heading, grid);
          root.append(section);
        });
        pager.textContent = "";
        if (pages < 2) return;
        var nav = document.createElement("nav");
        nav.className = "pager";
        nav.setAttribute("aria-label", "Страницы");
        function edge(label, target, enabled) {
          if (!enabled) {
            var span = document.createElement("span");
            span.className = "off";
            span.textContent = label;
            return span;
          }
          var anchor = document.createElement("a");
          anchor.href = link(kind, target);
          anchor.textContent = label;
          return anchor;
        }
        var mark = document.createElement("span");
        mark.textContent = current + " из " + pages;
        nav.append(edge("Назад", current - 1, current > 1), mark, edge("Дальше", current + 1, current < pages));
        pager.append(nav);
      }
      var urls = ["https://api.vvvion.space/v1/models", "/v1/models"];
      function attempt(index) {
        if (index >= urls.length) {
          root.textContent = "";
          var fail = document.createElement("p");
          fail.className = "empty";
          fail.textContent = "Список моделей сейчас недоступен.";
          root.append(fail);
          return;
        }
        fetch(urls[index], { headers: { Accept: "application/json" }, credentials: "omit" })
          .then(function (res) { if (!res.ok) throw new Error("status"); return res.json(); })
          .then(function (body) {
            var data = Array.isArray(body && body.data) ? body.data : [];
            render(data.map(function (row) {
              var id = row && typeof row.id === "string" ? row.id.trim() : "";
              if (!id) return null;
              var name = row.display_name && String(row.display_name).trim() ? String(row.display_name).trim() : id;
              return { id: id, name: name, type: row.type === "image" ? "image" : "chat" };
            }).filter(Boolean));
          })
          .catch(function () { attempt(index + 1); });
      }
      attempt(0);
    })();
  </script>
</body>
</html>`;
}

export function renderModelsError(): string {
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Модели · VVVion API</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0c0c0e;color:#f4f2ee;font:16px ui-sans-serif,system-ui"><p>Список моделей сейчас недоступен.</p></body></html>`;
}
