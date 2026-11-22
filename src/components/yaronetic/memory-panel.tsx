import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { readMemory, writeMemory, type MemoryState } from "@/lib/ai/memory";

export function MemoryPanel({ chatId }: { chatId?: string | null }) {
  const user = useCurrentUser();
  const [state, setState] = useState<MemoryState>(() => readMemory(null));
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const owner = user?.id || null;
  useEffect(() => {
    const pull = () => setState(readMemory(owner));
    pull();
    window.addEventListener("vv-memory-change", pull);
    window.addEventListener("storage", pull);
    return () => {
      window.removeEventListener("vv-memory-change", pull);
      window.removeEventListener("storage", pull);
    };
  }, [owner]);
  function save(next: MemoryState) {
    if (!owner) return false;
    try {
      writeMemory(owner, next);
      setState(next);
      return true;
    } catch {
      toast.error("Память не сохранилась: хранилище браузера недоступно");
      return false;
    }
  }
  const chat = chatId || "new";
  return (
    <section className="mt-4 rounded-2xl border border-line p-3" aria-label="Память ИИ">
      <h3 className="font-medium">Что ИИ знает обо мне</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Только устойчивые факты: имя, город, язык, профессия и то, как вам удобно получать ответы.
        Они попадают сами из разговора, и модель может дописать или забыть. Пароли и ключи не
        сохраняются. Записи можно поправить. Хранятся в этом браузере и пока не синхронизируются.
      </p>
      {!owner ? (
        <p className="mt-3 text-sm text-muted">Войдите, чтобы настроить личную память.</p>
      ) : (
        <>
          <label className="mt-2 flex min-h-11 items-center justify-between gap-3 text-sm">
            Использовать память
            <input
              type="checkbox"
              checked={state.enabled}
              onChange={(e) => save({ ...state, enabled: e.target.checked })}
              className="size-5 accent-[var(--accent)]"
            />
          </label>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            Без памяти в этом диалоге
            <input
              type="checkbox"
              checked={state.disabledChats.includes(chat)}
              onChange={(e) =>
                save({
                  ...state,
                  disabledChats: e.target.checked
                    ? [...state.disabledChats.filter((id) => id !== chat), chat]
                    : state.disabledChats.filter((id) => id !== chat),
                })
              }
              className="size-5 accent-[var(--accent)]"
            />
          </label>
          <ul className="mt-2 space-y-2">
            {state.entries.map((entry) => (
              <li key={entry.id} className="rounded-xl border border-line bg-bg p-3">
                <p className="whitespace-pre-wrap break-words text-sm">{entry.text}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="press min-h-10 rounded-lg border border-line px-3 text-xs"
                    onClick={() => {
                      setEditing(entry.id);
                      setText(entry.text);
                    }}
                  >
                    Изменить
                  </button>
                  <button
                    type="button"
                    className="press min-h-10 rounded-lg px-3 text-xs text-danger"
                    onClick={() => {
                      const saved = save({
                        ...state,
                        entries: state.entries.filter((item) => item.id !== entry.id),
                      });
                      if (saved && editing === entry.id) {
                        setEditing(null);
                        setText("");
                      }
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <form
            className="mt-3"
            onSubmit={(e) => {
              e.preventDefault();
              const value = text.trim();
              if (!value) return;
              if (!editing && state.entries.length >= 40) {
                toast.error("Можно сохранить до 40 записей");
                return;
              }
              const entry = {
                id: editing || crypto.randomUUID(),
                text: value,
                updatedAt: Date.now(),
              };
              const saved = save({
                ...state,
                entries: editing
                  ? state.entries.map((item) => (item.id === editing ? entry : item))
                  : [...state.entries, entry],
              });
              if (saved) {
                setText("");
                setEditing(null);
              }
            }}
          >
            <label className="text-xs text-muted">
              {editing ? "Изменить запись" : "Добавить предпочтение"}
              <textarea
                className="field mt-1 min-h-20 resize-y"
                value={text}
                maxLength={500}
                placeholder="Например: отвечай по-русски, сначала краткий вывод"
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <div className="mt-2 flex gap-2">
              <button
                type="submit"
                disabled={!text.trim()}
                className="press min-h-11 rounded-xl bg-accent px-4 text-sm text-accent-fg disabled:opacity-40"
              >
                {editing ? "Сохранить" : "Запомнить"}
              </button>
              {editing ? (
                <button
                  type="button"
                  className="press min-h-11 px-3 text-sm"
                  onClick={() => {
                    setEditing(null);
                    setText("");
                  }}
                >
                  Отмена
                </button>
              ) : null}
            </div>
          </form>
        </>
      )}
    </section>
  );
}
