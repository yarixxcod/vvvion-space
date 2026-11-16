import { pushBackLayer } from "@/lib/app-back";
import { useEffect, useState, useRef } from "react";
import { Download, LoaderCircle, Save } from "lucide-react";
import { toast } from "sonner";
import { BackButton } from "./back-button";
import { Markdown } from "./markdown";
import { readDocument, saveDocument } from "@/lib/files/documents.fn";
import { documentKind } from "@/lib/files/document-kind";
import { readDocx, writeDocx, type WordDocument } from "@/lib/files/docx";
const decode = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const encode = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
};
export function DocumentEditor({
  storage,
  file,
  onClose,
  onSaved,
}: {
  storage: "disk" | "mega";
  file: { id: string; name: string };
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [loaded, setLoaded] = useState<{
    version: string;
    raw: Uint8Array;
    word?: WordDocument;
  } | null>(null);
  const [text, setText] = useState(""),
    [paragraphs, setParagraphs] = useState<string[]>([]),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(false);
  const state = useRef({ dirty, saving });
  state.current = { dirty, saving };
  useEffect(() => {
    let dead = false;
    void readDocument({ data: { storage, id: file.id } })
      .then((result) => {
        if (dead) return;
        const raw = decode(result.data);
        if (documentKind(file.name) === "docx") {
          const word = readDocx(raw);
          setParagraphs(word.text);
          setLoaded({ version: result.version, raw, word });
        } else {
          try {
            setText(new TextDecoder("utf-8", { fatal: true }).decode(raw));
          } catch {
            throw new Error("Текст не в UTF-8. Сохраните копию в UTF-8 и загрузите заново.");
          }
          setLoaded({ version: result.version, raw });
        }
      })
      .catch((err) => {
        if (!dead) setError(err instanceof Error ? err.message : "Файл не открылся");
      });
    return () => {
      dead = true;
    };
  }, [storage, file.id, file.name]);
  const close = () => {
    if (state.current.saving) return;
    if (state.current.dirty && !window.confirm("Закрыть без сохранения изменений?")) return;
    onClose();
  };
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (state.current.dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, []);
  useEffect(() => pushBackLayer(() => close()), []);
  const bytes = () =>
    loaded?.word ? writeDocx(loaded.word, paragraphs) : new TextEncoder().encode(text);
  async function save() {
    if (!loaded || saving || !state.current.dirty) return;
    setSaving(true);
    setError("");
    try {
      const result = await saveDocument({
        data: { storage, id: file.id, version: loaded.version, data: encode(bytes()) },
      });
      state.current.dirty = false;
      setDirty(false);
      toast.success(
        result.backup
          ? "Сохранено. Предыдущая версия осталась в этой папке."
          : "Изменения сохранены",
      );
      await Promise.resolve(onSaved()).catch(() =>
        toast("Файл сохранён. Обновите список, если он ещё не изменился."),
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  function download() {
    try {
      const data = bytes();
      const url = URL.createObjectURL(new Blob([new Uint8Array(data).buffer]));
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось скачать");
    }
  }
  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col bg-bg text-fg sm:inset-4 sm:rounded-3xl sm:border sm:border-line"
      role="dialog"
      aria-modal="true"
      aria-label={`Редактор: ${file.name}`}
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line p-3">
        <BackButton onClick={close} label="Назад" />
        <button
          type="button"
          onClick={close}
          className="hidden min-h-11 rounded-xl border border-line px-3 text-sm md:block"
        >
          Закрыть
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">{file.name}</h2>
          <p className="text-xs text-muted">
            {dirty
              ? "Есть несохранённые изменения"
              : loaded
                ? "Все изменения сохранены"
                : "Открываем документ…"}
          </p>
        </div>
        <button
          type="button"
          aria-label="Скачать свою версию"
          onClick={download}
          disabled={!loaded}
          className="press grid size-11 place-items-center rounded-xl border border-line disabled:opacity-40"
        >
          <Download className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!loaded || !dirty || saving}
          className="press flex min-h-11 items-center gap-2 rounded-xl bg-accent px-3 text-sm text-accent-fg disabled:opacity-40"
        >
          {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saving ? "Сохраняем…" : "Сохранить"}
        </button>
      </header>
      {error ? (
        <p role="alert" className="m-3 rounded-xl border border-danger p-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {storage === "mega" ? (
        <p className="border-b border-line px-4 py-2 text-xs text-muted">
          При сохранении прежняя версия останется рядом как резервная копия. Для неё нужно свободное
          место.
        </p>
      ) : null}
      {loaded?.word ? (
        <p className="px-4 py-2 text-xs text-muted">
          Редактор текста абзацев DOCX. Структура, изображения и оформление остаются в документе.
          Сложные поля и вёрстку лучше менять в Word.
        </p>
      ) : null}
      {/\.(md|markdown)$/i.test(file.name) && loaded ? (
        <div className="flex gap-2 px-3 py-2">
          {[false, true].map((value) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={preview === value}
              onClick={() => setPreview(value)}
              className={`min-h-10 rounded-xl border px-4 text-sm ${preview === value ? "border-accent text-accent" : "border-line"}`}
            >
              {value ? "Просмотр" : "Редактор"}
            </button>
          ))}
        </div>
      ) : null}
      {!loaded && !error ? (
        <div
          role="status"
          className="grid flex-1 place-content-center gap-3 text-center text-muted"
        >
          <LoaderCircle className="mx-auto size-6 animate-spin" />
          Загружаем файл…
        </div>
      ) : loaded?.word ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
          <div className="mx-auto max-w-3xl space-y-2 rounded-2xl border border-line bg-elev p-4 sm:p-8">
            {paragraphs.map((part, index) => (
              <textarea
                key={index}
                aria-label={`Абзац ${index + 1}`}
                value={part}
                disabled={saving}
                onChange={(event) => {
                  setParagraphs((rows) =>
                    rows.map((row, i) =>
                      i === index ? event.target.value.replace(/[\r\n]+/g, " ") : row,
                    ),
                  );
                  setDirty(true);
                }}
                rows={Math.min(12, Math.max(2, Math.ceil(part.length / 65)))}
                className="block w-full resize-y rounded-lg border border-transparent bg-transparent p-2 text-base leading-relaxed outline-none focus:border-accent"
              />
            ))}
            <button
              type="button"
              disabled={saving || paragraphs.length >= 2000}
              className="min-h-11 rounded-xl border border-line px-4 text-sm"
              onClick={() => {
                setParagraphs((rows) => [...rows, ""]);
                setDirty(true);
              }}
            >
              Добавить абзац
            </button>
            <p className="text-xs text-faint">
              Переносы внутри абзаца заменяются пробелом. Новый абзац добавляется ниже.
            </p>
          </div>
        </div>
      ) : loaded ? (
        preview ? (
          <div className="min-h-0 flex-1 overflow-auto p-4 sm:px-10">
            <Markdown text={text} />
          </div>
        ) : (
          <textarea
            aria-label="Содержимое файла"
            value={text}
            disabled={saving}
            onChange={(event) => {
              setText(event.target.value);
              setDirty(true);
            }}
            spellCheck={/\.(txt|md|markdown)$/i.test(file.name)}
            autoCapitalize="off"
            autoCorrect="off"
            className={`min-h-0 w-full flex-1 resize-none bg-bg p-4 text-base leading-relaxed text-fg outline-none sm:p-6 ${/\.(txt|md|markdown)$/i.test(file.name) ? "" : "font-mono"}`}
            style={{ tabSize: 2 }}
          />
        )
      ) : null}
      <footer className="shrink-0 border-t border-line px-4 py-2 pb-[max(.5rem,env(safe-area-inset-bottom))] text-xs text-muted">
        {loaded?.word
          ? `Абзацев: ${paragraphs.length}`
          : `${text.length.toLocaleString("ru-RU")} символов`}
        {dirty ? " · не сохранено" : ""}
        <span className="hidden sm:inline"> · Ctrl / ⌘ + S — сохранить</span>
      </footer>
    </div>
  );
}
