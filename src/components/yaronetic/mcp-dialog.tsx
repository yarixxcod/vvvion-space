import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Plug, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { pushBackLayer } from "@/lib/app-back";
import { loadMcp, saveMcp, type McpLink } from "@/lib/ai/mcp";
import { probeMcp } from "@/lib/ai/mcp-probe";
import { ui } from "@/lib/i18n";
import { useLang, useTx } from "@/lib/lang";
import { cn } from "@/lib/utils";

export function McpDialog({ open, onClose, onBack }: { open: boolean; onClose: () => void; onBack: () => void }) {
  const lang = useLang();
  const tx = useTx();
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [rows, setRows] = useState<McpLink[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [found, setFound] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => setNode(document.body), []);
  useEffect(() => {
    if (!open) return;
    setRows(loadMcp());
    setFound([]);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    return pushBackLayer(onBack);
  }, [open, onBack]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onBack]);

  if (!open || !node) return null;

  function commit(next: McpLink[]) {
    const sliced = next.slice(0, 4);
    setRows(sliced);
    saveMcp(sliced);
  }

  function hostOf(value: string) {
    try {
      return new URL(value).hostname.replace(/^www\./, "");
    } catch {
      return "MCP";
    }
  }

  function errText(err: unknown) {
    if (err instanceof Error && err.message) return err.message;
    if (err && typeof err === "object" && "message" in err && typeof err.message === "string") return err.message;
    return tx({ ru: "Сервер MCP не ответил", en: "The MCP server did not answer", kk: "MCP сервер жауап бермеді" });
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4" role="presentation" onClick={onBack}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-title"
        className="flex max-h-[min(100dvh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-line bg-elev shadow-[var(--shadow)] sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-2 border-b border-line px-3 py-3 sm:px-5">
          <div className="flex min-w-0 items-start gap-1">
            <button type="button" className="press inline-flex size-11 shrink-0 items-center justify-center rounded-2xl text-fg" aria-label={ui(lang, "close")} onClick={onBack}>
              <ChevronLeft className="size-6" strokeWidth={1.75} />
            </button>
            <div className="min-w-0 pt-1">
              <h2 id="mcp-title" className="text-base font-medium">MCP</h2>
              <p className="text-sm text-muted">{tx({ ru: "Сервер по ссылке https. Инструменты попадут в следующий ответ.", en: "A server by an https link. Its tools go into the next reply.", kk: "https сілтемесіндегі сервер. Құралдар келесі жауапқа кіреді." })}</p>
            </div>
          </div>
          <button type="button" className="press inline-flex size-11 shrink-0 items-center justify-center rounded-2xl border border-line text-muted" aria-label={ui(lang, "close")} onClick={onClose}>
            <X className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {rows.length === 0 ? (
            <p className="px-1 text-sm text-muted">{tx({ ru: "Пока ни одного сервера. Добавьте ссылку и проверьте её.", en: "No servers yet. Add a link and probe it.", kk: "Әзірге сервер жоқ. Сілтеме қосып, тексеріңіз." })}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((row) => (
                <li key={row.id} className="rounded-2xl border border-line px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    <Plug className="mt-0.5 size-4 shrink-0 text-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{row.name}</p>
                      <p className="truncate text-[13px] text-faint">{hostOf(row.url)}</p>
                      {row.tools.length > 0 ? <p className="mt-1 text-[13px] text-muted">{row.tools.slice(0, 6).join(", ")}</p> : null}
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={row.enabled}
                      aria-label={row.enabled ? tx({ ru: "Сервер включён", en: "Server is on", kk: "Сервер қосулы" }) : tx({ ru: "Сервер выключен", en: "Server is off", kk: "Сервер өшірулі" })}
                      className={cn("relative h-8 w-14 shrink-0 rounded-full", row.enabled ? "bg-accent" : "border border-line-strong bg-transparent")}
                      onClick={() => commit(rows.map((item) => (item.id === row.id ? { ...item, enabled: !item.enabled } : item)))}
                    >
                      <span className={cn("absolute top-1 size-6 rounded-full", row.enabled ? "left-7 bg-accent-fg" : "left-1 bg-faint")} />
                    </button>
                    <button
                      type="button"
                      className="press inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-faint"
                      aria-label={ui(lang, "delete")}
                      onClick={() => commit(rows.filter((item) => item.id !== row.id))}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form
            className="mt-4 flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const clean = url.trim();
              if (!clean.startsWith("https://") || clean.length > 300 || clean.includes("@")) {
                toast.error(tx({ ru: "Нужна ссылка https на сервер MCP", en: "An https link to an MCP server is required", kk: "MCP серверінің https сілтемесі керек" }));
                return;
              }
              const exists = rows.some((row) => row.url === clean);
              if (!exists && rows.length >= 4) {
                toast.error(tx({ ru: "Не больше четырёх серверов", en: "No more than four servers", kk: "Төрт серверден артық емес" }));
                return;
              }
              const next: McpLink = {
                id: rows.find((row) => row.url === clean)?.id || crypto.randomUUID(),
                name: name.trim().slice(0, 40) || hostOf(clean),
                url: clean,
                enabled: true,
                tools: found,
              };
              commit([next, ...rows.filter((row) => row.url !== clean)]);
              setName("");
              setUrl("");
              setFound([]);
            }}
          >
            <input value={name} onChange={(event) => setName(event.target.value)} className="field" maxLength={40} placeholder={tx({ ru: "Название", en: "Name", kk: "Атауы" })} />
            <input value={url} onChange={(event) => { setUrl(event.target.value); setFound([]); }} className="field" maxLength={300} inputMode="url" placeholder="https://" spellCheck={false} />
            {found.length > 0 ? <p className="px-1 text-[13px] text-muted">{found.join(", ")}</p> : null}
            <div className="flex gap-2">
              <button
                type="button"
                className="press h-11 flex-1 rounded-2xl border border-line text-sm disabled:opacity-40"
                disabled={busy || !url.trim()}
                onClick={() => {
                  const clean = url.trim();
                  setBusy(true);
                  void probeMcp({ data: clean })
                    .then((result) => {
                      setFound(result.tools);
                      toast(tx({ ru: `Инструментов: ${result.tools.length}`, en: `Tools: ${result.tools.length}`, kk: `Құрал: ${result.tools.length}` }));
                    })
                    .catch((err) => toast.error(errText(err)))
                    .finally(() => setBusy(false));
                }}
              >
                {busy ? tx({ ru: "Проверяю…", en: "Checking…", kk: "Тексеруде…" }) : tx({ ru: "Проверить", en: "Check", kk: "Тексеру" })}
              </button>
              <button type="submit" className="press h-11 flex-1 rounded-2xl bg-fg text-sm font-medium text-bg">
                {tx({ ru: "Добавить", en: "Add", kk: "Қосу" })}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    node,
  );
}
