import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LoaderMark } from "@/components/yaronetic/page-loader";
import { getApiAdmin, revokeUserApiKeys, saveApiAdmin, setApiModelFlag, type ApiAdminDesk } from "@/lib/api/desk";
import type { ApiSettings } from "@/lib/api/settings";

function textOf(value: number | null): string {
  return value == null ? "" : String(value);
}

export function ApiAdmin() {
  const [desk, setDesk] = useState<ApiAdminDesk | null>(null);
  const [draft, setDraft] = useState<ApiSettings | null>(null);
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    void getApiAdmin().then((row) => {
      setDesk(row);
      setDraft(row.settings);
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "API-админка не открылась");
    });
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    try {
      const settings = await saveApiAdmin({ data: draft });
      setDraft(settings);
      toast("Сохранено");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не сохранилось");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(name: string, kind: "chat" | "image", enabled: boolean) {
    try {
      await setApiModelFlag({ data: { name, kind, enabled } });
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Флаг не изменился");
    }
  }

  async function revokeAll() {
    if (!userId.trim() || busy) return;
    if (!window.confirm("Отозвать все ключи этого пользователя?")) return;
    setBusy(true);
    try {
      const result = await revokeUserApiKeys({ data: { userId } });
      toast(`Отозвано: ${result.revoked}`);
      setUserId("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не отозвано");
    } finally {
      setBusy(false);
    }
  }

  if (!desk || !draft) return <LoaderMark className="vv-loader-sm mt-6" />;
  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-line bg-elev p-4">
        <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
          Сервис включён
          <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
        </label>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Field label="Запросов в минуту" value={String(draft.perMinute)} onChange={(value) => setDraft({ ...draft, perMinute: Number(value) || 1 })} />
          <Field label="Максимум токенов ответа" value={String(draft.maxOutputTokens)} onChange={(value) => setDraft({ ...draft, maxOutputTokens: Number(value) || 1 })} />
          <Field label="Запросов в сутки (пусто = без лимита)" value={textOf(draft.dailyRequests)} onChange={(value) => setDraft({ ...draft, dailyRequests: value.trim() === "" ? null : Number(value) })} />
          <Field label="Токенов в сутки (пусто = без лимита)" value={textOf(draft.dailyTokens)} onChange={(value) => setDraft({ ...draft, dailyTokens: value.trim() === "" ? null : Number(value) })} />
          <Field label="Картинок в сутки (пусто = без лимита)" value={textOf(draft.dailyImages)} onChange={(value) => setDraft({ ...draft, dailyImages: value.trim() === "" ? null : Number(value) })} />
          <Field label="Ключей на пользователя (0 = без лимита)" value={String(draft.maxKeys)} onChange={(value) => setDraft({ ...draft, maxKeys: value.trim() === "" ? 0 : Number(value) })} />
        </div>
        <button type="button" disabled={busy} className="press mt-3 min-h-11 rounded-xl bg-accent px-4 text-sm text-accent-fg disabled:opacity-50" onClick={() => void save()}>Сохранить</button>
        <p className="mt-3 text-xs text-muted">За 24 ч: {desk.stats.requests} запросов, {desk.stats.tokens} токенов, {desk.stats.images} картинок, {desk.stats.errors} ошибок.</p>
        <ul className="mt-2 space-y-1 text-xs text-muted">
          {desk.stats.top.map((row) => <li key={row.userId} className="truncate">{row.userId} · {row.requests}</li>)}
        </ul>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="id пользователя" className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-sm" />
          <button type="button" disabled={busy} className="press min-h-11 rounded-xl border border-line px-3 text-sm" onClick={() => void revokeAll()}>Отозвать все ключи</button>
        </div>
      </section>
      <section className="rounded-2xl border border-line bg-elev p-4">
        <p className="text-sm">Доступна в API</p>
        <ul className="mt-2 space-y-1">
          {desk.models.map((model) => (
            <li key={`${model.kind}:${model.name}`} className="flex min-h-11 items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{model.displayName} <span className="text-xs text-muted">{model.kind === "image" ? "картинка" : "чат"}</span></span>
              <input type="checkbox" checked={model.apiEnabled} onChange={(event) => void toggle(model.name, model.kind, event.target.checked)} aria-label={model.name} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-xs text-muted">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm" />
    </label>
  );
}
