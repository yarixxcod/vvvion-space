import { useState } from "react";
import { Brain, Download, Loader2, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { readMemory } from "@/lib/ai/memory";
import {
  CATEGORY_LABELS,
  CATEGORIES,
  isSensitive,
  type Category,
  type MemoryFact,
  type Workspace,
} from "@/lib/memory/policy";
import {
  updateMemorySettings,
  saveUserMemory,
  deleteUserMemory,
  clearUserMemories,
  exportUserMemories,
  setMemoryChatPolicy,
} from "@/lib/memory/api";
function date(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
export function MemoryWorkspace({
  initial,
  chatId,
  onState,
}: {
  initial: Workspace;
  chatId?: string | null;
  onState: (s: Workspace) => void;
}) {
  const user = useCurrentUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const [sensitive, setSensitive] = useState(false);
  const [confirm, setConfirm] = useState<MemoryFact | "all" | null>(null);
  const [editing, setEditing] = useState<MemoryFact | null>(null);
  const [text, setText] = useState("");
  const [category, setCategory] = useState<Category>("about");
  const [expiry, setExpiry] = useState("");
  const [filter, setFilter] = useState("");
  const state = initial;
  async function run(work: () => Promise<Workspace>, message: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await work();
      onState({
        ...next,
        chatDisabled: next.chatDisabled || Boolean(chatId && state.chatDisabled),
      });
      toast.success(message);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выполнить действие");
      return false;
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setText("");
    setEditing(null);
    setSensitive(false);
    setExpiry("");
  }
  const legacy = readMemory(user?.id || null).entries;
  const visible = state.entries.filter((e) =>
    e.content.toLocaleLowerCase("ru").includes(filter.toLocaleLowerCase("ru")),
  );
  return (
    <section
      className="mt-4 animate-in fade-in duration-200 space-y-4 rounded-3xl border border-line bg-elev p-4"
      aria-label="Память VVVion"
    >
      <header className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent/15 text-accent">
          <Brain className="size-5" />
        </span>
        <div>
          <h3 className="text-lg font-medium">Память VVVion</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Личные факты для разных моделей и персонажей. Общие для вашего аккаунта на сайте и в
            Telegram.
          </p>
        </div>
      </header>
      <div className="space-y-1 rounded-2xl bg-subtle p-3">
        <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
          Использовать общую память
          <input
            type="checkbox"
            className="size-5 accent-[var(--accent)]"
            checked={state.prefs.enabled}
            disabled={busy}
            onChange={(e) =>
              void run(
                () =>
                  updateMemorySettings({
                    data: {
                      enabled: e.target.checked,
                      automatic: e.target.checked && state.prefs.automatic,
                    },
                  }),
                "Настройки сохранены",
              )
            }
          />
        </label>
        <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
          Автоматически запоминать факты
          <input
            type="checkbox"
            className="size-5 accent-[var(--accent)]"
            checked={state.prefs.automatic}
            disabled={busy || !state.prefs.enabled}
            onChange={(e) => {
              if (e.target.checked) setConsent(true);
              else
                void run(
                  () =>
                    updateMemorySettings({
                      data: { enabled: state.prefs.enabled, automatic: false },
                    }),
                  "Автозапоминание выключено",
                );
            }}
          />
        </label>
        {chatId ? (
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            Без памяти в этом диалоге
            <input
              type="checkbox"
              className="size-5 accent-[var(--accent)]"
              checked={state.chatDisabled}
              disabled={busy}
              onChange={(e) => {
                setBusy(true);
                setError("");
                void setMemoryChatPolicy({ data: { chatKey: chatId, disabled: e.target.checked } })
                  .then(onState)
                  .catch((e) => setError(e instanceof Error ? e.message : "Режим не сохранён"))
                  .finally(() => setBusy(false));
              }}
            />
          </label>
        ) : null}
      </div>
      {consent ? (
        <div
          role="dialog"
          aria-label="Согласие на автоматическую память"
          className="rounded-2xl border border-accent p-4"
        >
          <p className="text-sm font-medium">Что может запоминаться</p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Только явно сообщённые вами долговременные сведения: обращение, интересы, проекты, цели
            и предпочтения. Ответы моделей, цитаты и вложения не используются. Чувствительные данные
            не сохраняются автоматически. Секреты запрещены всегда. Вы сможете изменить или удалить
            каждую запись.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              disabled={busy}
              className="press min-h-11 rounded-xl bg-accent px-3 text-sm text-accent-fg"
              onClick={() =>
                void run(
                  () =>
                    updateMemorySettings({
                      data: { enabled: true, automatic: true, consent: true },
                    }),
                  "Автозапоминание включено",
                ).then((ok) => {
                  if (ok) setConsent(false);
                })
              }
            >
              Разрешаю автозапоминание
            </button>
            <button
              disabled={busy}
              className="press min-h-11 px-3 text-sm"
              onClick={() => setConsent(false)}
            >
              Не сейчас
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl border border-danger/30 p-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-xs text-muted">{state.entries.length} из 120 записей</p>
        <button
          disabled={busy}
          className="press inline-flex min-h-11 items-center gap-1 rounded-xl border border-line px-3 text-xs"
          onClick={() => {
            setBusy(true);
            void exportUserMemories()
              .then((data) => {
                const href = URL.createObjectURL(
                  new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
                );
                const a = document.createElement("a");
                a.href = href;
                a.download = "vvvion-memory.json";
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(href), 10000);
              })
              .catch(() => setError("Экспорт не удался"))
              .finally(() => setBusy(false));
          }}
        >
          <Download className="size-3.5" />
          Экспорт JSON
        </button>
        <button
          disabled={busy || !state.entries.length}
          className="press min-h-11 rounded-xl px-3 text-xs text-danger"
          onClick={() => setConfirm("all")}
        >
          Очистить всё
        </button>
      </div>
      {confirm ? (
        <div
          role="dialog"
          aria-label="Подтверждение удаления памяти"
          className="rounded-2xl border border-danger/30 p-4"
        >
          <p className="text-sm">
            {confirm === "all"
              ? "Удалить все записи? Автозапоминание будет выключено, чтобы память не заполнилась снова."
              : "Удалить эту запись из памяти? Это действие нельзя отменить."}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              disabled={busy}
              className="press min-h-11 rounded-xl border border-danger/40 px-3 text-sm text-danger"
              onClick={() =>
                void run(
                  () =>
                    confirm === "all"
                      ? clearUserMemories({ data: { confirm: "CLEAR_MEMORY" } })
                      : deleteUserMemory({ data: { id: confirm.id, version: confirm.version } }),
                  "Память обновлена",
                ).then((ok) => {
                  if (ok) {
                    setConfirm(null);
                    reset();
                  }
                })
              }
            >
              Подтвердить удаление
            </button>
            <button
              disabled={busy}
              className="press min-h-11 px-3 text-sm"
              onClick={() => setConfirm(null)}
            >
              Отмена
            </button>
          </div>
        </div>
      ) : null}
      {state.entries.length ? (
        <input
          aria-label="Поиск по памяти"
          placeholder="Найти факт…"
          className="field"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-line p-5 text-center">
          <Brain className="mx-auto size-6 text-muted" />
          <p className="mt-2 text-sm">Память пока пуста</p>
          <p className="mt-1 text-xs text-muted">
            Добавьте первый факт вручную. Автоматическое сохранение требует вашего согласия.
          </p>
        </div>
      )}
      {state.entries.length && !visible.length ? (
        <p className="py-3 text-sm text-muted">Ничего не найдено.</p>
      ) : null}
      {CATEGORIES.map((cat) => {
        const entries = visible.filter((e) => e.category === cat);
        return entries.length ? (
          <div key={cat}>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
              {CATEGORY_LABELS[cat]}
            </h4>
            <ul className="space-y-2">
              {entries.map((e) => (
                <li key={e.id} className="rounded-2xl border border-line bg-bg p-3">
                  <p className="break-words text-sm">{e.content}</p>
                  <p className="mt-2 text-xs text-muted">
                    {e.source_type === "automatic" ? "Авто · явное сообщение" : "Добавлено вами"} ·
                    создано {date(e.created_at)}
                    <br />
                    Обновлено {date(e.updated_at)}
                    {e.expires_at ? ` · до ${date(e.expires_at)}` : ""}
                  </p>
                  {e.status === "conflict" ? (
                    <p className="mt-2 text-xs text-accent">
                      Отличается от сохранённого факта. Не используется, пока вы не подтвердите
                      замену.
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1">
                    <button
                      disabled={busy}
                      className="press inline-flex min-h-11 items-center gap-1 rounded-xl border border-line px-3 text-xs"
                      onClick={() => {
                        setEditing(e);
                        setText(e.content);
                        setCategory(e.category);
                        setSensitive(false);
                        setExpiry(e.expires_at?.slice(0, 10) || "");
                      }}
                    >
                      <Pencil className="size-3" />
                      Изменить
                    </button>
                    {e.status === "conflict" ? (
                      <button
                        disabled={busy}
                        className="press min-h-11 rounded-xl px-3 text-xs text-accent"
                        onClick={() =>
                          void run(
                            () =>
                              saveUserMemory({
                                data: {
                                  id: e.id,
                                  version: e.version,
                                  content: e.content,
                                  category: e.category,
                                  activate: true,
                                },
                              }),
                            "Факт подтверждён",
                          )
                        }
                      >
                        Принять замену
                      </button>
                    ) : null}
                    <button
                      disabled={busy}
                      className="press inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-xs text-danger"
                      onClick={() => setConfirm(e)}
                    >
                      <Trash2 className="size-3" />
                      Удалить
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null;
      })}
      <form
        className="space-y-3 rounded-2xl bg-subtle p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              saveUserMemory({
                data: {
                  id: editing?.id,
                  version: editing?.version,
                  content: text,
                  category,
                  confirmSensitive: sensitive,
                  expiresAt: expiry ? new Date(expiry + "T23:59:59Z").toISOString() : null,
                },
              }),
            "Запись сохранена",
          ).then((ok) => {
            if (ok) reset();
          });
        }}
      >
        <h4 className="flex items-center gap-1 text-sm font-medium">
          <Plus className="size-4" />
          {editing ? "Редактирование факта" : "Добавить факт"}
        </h4>
        <label className="block text-xs text-muted">
          Что запомнить
          <textarea
            className="field mt-1 min-h-24 resize-y"
            value={text}
            maxLength={500}
            disabled={busy}
            onChange={(e) => {
              setText(e.target.value);
              setSensitive(false);
            }}
            placeholder="Например: мой основной проект — VVVion Space"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-muted">
            Категория
            <select
              className="field mt-1"
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-muted">
            Срок хранения, необязательно
            <input
              aria-label="Срок хранения"
              type="date"
              className="field mt-1"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </label>
        </div>
        {isSensitive(text) ? (
          <label className="flex items-start gap-2 text-xs leading-relaxed">
            <input
              type="checkbox"
              checked={sensitive}
              onChange={(e) => setSensitive(e.target.checked)}
              className="mt-1"
            />
            Я отдельно разрешаю сохранить чувствительные сведения именно в этой записи. Они могут
            быть переданы выбранной модели при включённой памяти.
          </label>
        ) : null}
        <div className="flex gap-2">
          <button
            disabled={busy || text.trim().length < 3}
            className="press inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 text-sm text-accent-fg disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}Сохранить факт
          </button>
          {editing ? (
            <button
              type="button"
              disabled={busy}
              className="press min-h-11 px-3 text-sm"
              onClick={reset}
            >
              Отмена
            </button>
          ) : null}
        </div>
      </form>
      {legacy.length ? (
        <div className="rounded-2xl border border-line p-3">
          <p className="text-xs text-muted">
            В этом браузере есть старые ручные заметки ({legacy.length}). Они не переносятся
            автоматически. Можно открыть заметку в форме и проверить перед сохранением.
          </p>
          <button
            className="press mt-2 min-h-11 text-xs"
            type="button"
            disabled={busy}
            onClick={() => {
              reset();
              setText(
                legacy.find((e) => !state.entries.some((n) => n.content === e.text))?.text ||
                  legacy[0].text,
              );
            }}
          >
            Проверить старую заметку
          </button>
        </div>
      ) : null}
      <footer className="flex gap-2 text-xs leading-relaxed text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <p>
          Секреты сохранять нельзя. Автоматические факты извлекаются только из ваших прямых
          сообщений. Выключение останавливает использование памяти и автоизвлечение. Удаление
          убирает активные записи; ранее отправленные сообщения не меняются, а резервные копии могут
          храниться некоторое время по правилам хостинга.
        </p>
      </footer>
    </section>
  );
}
