import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { SecretInput } from "@/components/yaronetic/secret-input";
import { getWhisperSettings, saveWhisperSettings, type WhisperSettings } from "@/lib/ai/whisper";

type Draft = {
  baseUrl: string;
  model: string;
  language: string;
  apiKey: string;
  clearKey: boolean;
  hasKey: boolean;
  ready: boolean;
};

function fromSettings(row: WhisperSettings): Draft {
  return {
    baseUrl: row.baseUrl,
    model: row.model,
    language: row.language,
    apiKey: "",
    clearKey: false,
    hasKey: row.hasKey,
    ready: row.ready,
  };
}

export function WhisperCard() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const row = await getWhisperSettings();
    setDraft(fromSettings(row));
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load().catch(() => {
      if (!cancelled) setError("Расшифровка сейчас недоступна");
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    try {
      const next = await saveWhisperSettings({
        data: {
          baseUrl: draft.baseUrl,
          model: draft.model,
          language: draft.language,
          apiKey: draft.apiKey,
          clearKey: draft.clearKey,
        },
      });
      setDraft(fromSettings(next));
      toast(next.ready ? "Расшифровка подключена" : "Расшифровка сохранена");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось сохранить расшифровку";
      toast.error(message.length > 180 ? "Не удалось сохранить расшифровку" : message);
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-line bg-bg p-3">
        <h3 className="text-sm font-medium">Расшифровка</h3>
        <p className="mt-1 text-sm text-danger">{error}</p>
      </section>
    );
  }

  if (!draft) {
    return (
      <section className="rounded-2xl border border-line bg-bg p-3">
        <h3 className="text-sm font-medium">Расшифровка</h3>
        <PageLoader compact />
      </section>
    );
  }

  return (
    <section>
      <h3 className="text-sm font-medium">Расшифровка</h3>
      <p className="mt-1 text-xs text-faint">
        Голосовой ввод идёт на совместимый с Whisper адрес, метод /audio/transcriptions. Ключ остаётся на сервере. Пустое поле оставляет текущий ключ или ключ окружения, если он задан.
      </p>
      <form
        className="mt-3 space-y-2 rounded-2xl border border-line bg-bg p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className="text-xs text-muted">{draft.ready && !draft.clearKey ? "Расшифровка подключена." : "Расшифровка ещё не подключена."}</p>
        <label className="block text-xs text-faint">
          Эндпойнт
          <input
            className="field mt-1 font-mono text-sm"
            value={draft.baseUrl}
            maxLength={300}
            placeholder="https://api.openai.com/v1"
            autoComplete="off"
            onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
          />
        </label>
        <label className="block text-xs text-faint">
          Модель
          <input
            className="field mt-1 font-mono text-sm"
            value={draft.model}
            maxLength={80}
            placeholder="whisper-1"
            autoComplete="off"
            onChange={(event) => setDraft({ ...draft, model: event.target.value })}
          />
        </label>
        <label className="block text-xs text-faint">
          Язык
          <input
            className="field mt-1 font-mono text-sm"
            value={draft.language}
            maxLength={2}
            placeholder="ru или пусто"
            autoComplete="off"
            onChange={(event) => setDraft({ ...draft, language: event.target.value })}
          />
        </label>
        <label className="block text-xs text-faint">
          Ключ
          <div className="mt-1">
            <SecretInput
              value={draft.apiKey}
              maxLength={400}
              placeholder={draft.hasKey && !draft.clearKey ? "Ключ сохранён — введите новый, чтобы заменить" : "sk-…"}
              autoComplete="off"
              className="font-mono"
              label="Ключ расшифровки"
              onChange={(value) => setDraft({ ...draft, apiKey: value, clearKey: false })}
            />
          </div>
        </label>
        <p className="text-xs text-faint">
          {draft.clearKey
            ? "Ключ будет сброшен."
            : draft.hasKey
              ? "Свой ключ задан."
              : "Своего ключа нет — сработает ключ окружения, если он есть."}
        </p>
        {draft.hasKey ? (
          <button
            type="button"
            className="press h-8 rounded-lg px-2 text-xs text-muted"
            onClick={() => setDraft({ ...draft, clearKey: !draft.clearKey, apiKey: "" })}
          >
            {draft.clearKey ? "Оставить ключ" : "Сбросить ключ"}
          </button>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="press h-10 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40"
        >
          Сохранить расшифровку
        </button>
      </form>
    </section>
  );
}
