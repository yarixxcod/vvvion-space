import { useEffect, useState } from "react";
import { BrainCircuit, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { cleanUserText } from "@/lib/ai/memory-doc";
import { readMemory, type MemoryState } from "@/lib/ai/memory";
import { memoryPhaseLabel, pullOwner, saveOwner, type SyncPhase } from "@/lib/ai/memory-remote";

const EMPTY: MemoryState = { enabled: false, entries: [], disabledChats: [] };

export function MemoryPanel({ chatId }: { chatId?: string | null }) {
  const user = useCurrentUser();
  const owner = user?.id || null;
  const [tracked, setTracked] = useState(owner);
  const [state, setState] = useState<MemoryState>(() => (owner ? readMemory(owner) : EMPTY));
  const [phase, setPhase] = useState<SyncPhase>(owner ? "loading" : "idle");
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  if (tracked !== owner) {
    setTracked(owner);
    setState(owner ? readMemory(owner) : EMPTY);
    setPhase(owner ? "loading" : "idle");
    setSyncedAt(null);
    setProblem("");
    setText("");
    setEditing(null);
    setConfirmClear(false);
  }
  useEffect(() => {
    if (!owner) return;
    let cancel = false;
    const apply = (result: { state: MemoryState; phase: SyncPhase; syncedAt: string | null; message?: string }) => {
      if (cancel) return;
      setState(result.state);
      setPhase(result.phase);
      setSyncedAt(result.syncedAt);
      setProblem(result.message || "");
    };
    const refresh = () => {
      setPhase((current) => (current === "saving" ? current : "loading"));
      void pullOwner(owner).then(apply);
    };
    refresh();
    const onChange = () => {
      if (!cancel) setState(readMemory(owner));
    };
    const onOnline = () => {
      void pullOwner(owner).then(apply);
    };
    window.addEventListener("vv-memory-change", onChange);
    window.addEventListener("online", onOnline);
    return () => {
      cancel = true;
      window.removeEventListener("vv-memory-change", onChange);
      window.removeEventListener("online", onOnline);
    };
  }, [owner]);
  function save(next: MemoryState) {
    if (!owner) return;
    setState(next);
    setPhase("saving");
    setProblem("");
    void saveOwner(owner, next).then((result) => {
      setState(result.state);
      setPhase(result.phase);
      setSyncedAt(result.syncedAt);
      setProblem(result.message || "");
      if (!result.ok) toast.error(result.message || "Не удалось сохранить, попробуйте ещё раз");
    });
  }
  const chat = chatId || "new";
  const status = memoryPhaseLabel(phase, syncedAt);
  const showEntries = phase !== "loading" || state.entries.length > 0;
  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-accent/35 bg-gradient-to-br from-accent/10 via-transparent to-transparent p-3" aria-label="VVVion Memory">
      <div className="flex items-center gap-3 rounded-xl border border-accent/20 bg-subtle p-3">
        <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent/15 text-accent"><BrainCircuit size={27} strokeWidth={1.8} aria-hidden="true" /></div>
        <div className="min-w-0 flex-1"><h3 className="font-semibold tracking-tight">VVVion Memory</h3><p className="text-xs text-muted">Персональная память ИИ · {state.entries.length} фактов</p></div>
        <ShieldCheck className="shrink-0 text-muted" size={18} aria-label="Контроль памяти" />
      </div>
      <h4 className="mt-3 text-sm font-medium">Что ИИ знает обо мне</h4>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Только устойчивые факты: имя, город, язык, профессия и то, как вам удобно получать ответы.
        Они попадают сами из разговора, и модель может дописать или забыть. Пароли и ключи не
        сохраняются. Записи можно поправить. Записи хранятся в вашем аккаунте и доступны на всех устройствах.
      </p>
      {owner && status ? (
        <p className="mt-2 text-xs text-muted" aria-live="polite">
          {status}
          {problem && phase !== "loading" && phase !== "saving" ? ` — ${problem}` : ""}
        </p>
      ) : null}
      {owner && (phase === "error" || phase === "pending") ? (
        <button
          type="button"
          className="press mt-2 min-h-10 rounded-lg border border-line px-3 text-xs"
          onClick={() => {
            setPhase("loading");
            void pullOwner(owner).then((result) => {
              setState(result.state);
              setPhase(result.phase);
              setSyncedAt(result.syncedAt);
              setProblem(result.message || "");
            });
          }}
        >
          Повторить синхронизацию
        </button>
      ) : null}
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
          {showEntries ? (
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
                        save({ ...state, entries: state.entries.filter((item) => item.id !== entry.id) });
                        if (editing === entry.id) {
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
          ) : (
            <p className="mt-3 text-sm text-muted">Память обновляется</p>
          )}
          <form
            className="mt-3"
            onSubmit={(e) => {
              e.preventDefault();
              const value = cleanUserText(text);
              if (!value) {
                if (text.trim()) toast.error("Пароли и ключи не сохраняются");
                return;
              }
              const existing = state.entries.find((entry) => entry.text.toLowerCase() === value.toLowerCase());
              if (!editing && !existing && state.entries.length >= 40) {
                toast.error("Можно сохранить до 40 записей");
                return;
              }
              const entry = {
                id: editing || existing?.id || crypto.randomUUID(),
                text: value,
                updatedAt: Date.now(),
              };
              save({
                ...state,
                entries: state.entries.some((item) => item.id === entry.id)
                  ? state.entries.map((item) => (item.id === entry.id ? entry : item))
                  : [...state.entries, entry],
              });
              setText("");
              setEditing(null);
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
            <div className="mt-2 flex flex-wrap gap-2">
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
              {state.entries.length ? (
                confirmClear ? (
                  <>
                    <button
                      type="button"
                      className="press min-h-11 rounded-xl px-3 text-sm text-danger"
                      onClick={() => {
                        save({ ...state, entries: [] });
                        setConfirmClear(false);
                        setEditing(null);
                        setText("");
                      }}
                    >
                      Да, очистить
                    </button>
                    <button type="button" className="press min-h-11 px-3 text-sm" onClick={() => setConfirmClear(false)}>
                      Отмена
                    </button>
                  </>
                ) : (
                  <button type="button" className="press min-h-11 px-3 text-sm text-danger" onClick={() => setConfirmClear(true)}>
                    Очистить всё
                  </button>
                )
              ) : null}
            </div>
          </form>
        </>
      )}
    </section>
  );
}
