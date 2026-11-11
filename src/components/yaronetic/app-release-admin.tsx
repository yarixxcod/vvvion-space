import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { UploadMeter, sizeLabel, type UploadView } from "@/components/yaronetic/upload-meter";
import { getBearerToken } from "@/lib/auth/client";

const CHUNK = 512 * 1024;

type ReleaseView = {
  source: "live" | "builtin" | "none";
  versionCode: number;
  versionName: string;
  fileName: string;
  changelog: string;
  force: boolean;
  size: number;
};

type Status = { current: ReleaseView | null; nextCode: number };

async function call(body?: unknown): Promise<Status & { received?: number; message?: string }> {
  const headers = new Headers();
  if (body) headers.set("content-type", "application/json");
  const token = getBearerToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch("/api/app-release", {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const parsed = (await res.json().catch(() => ({}))) as Status & { received?: number; message?: string };
  if (!res.ok) throw new Error(parsed.message || "Не получилось");
  return parsed;
}

function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) text += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(text);
}

export function AppReleaseCard() {
  const [info, setInfo] = useState<Status | null>(null);
  const [versionName, setVersionName] = useState("");
  const [versionCode, setVersionCode] = useState("");
  const [notes, setNotes] = useState("");
  const [force, setForce] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [meter, setMeter] = useState<UploadView | null>(null);

  useEffect(() => {
    let dead = false;
    void call()
      .then((row) => {
        if (dead) return;
        setInfo(row);
        setVersionCode(String(row.nextCode));
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Обновление не открылось"));
    return () => {
      dead = true;
    };
  }, []);

  async function publish() {
    if (busy) return;
    if (!file) {
      toast("Сначала выберите файл");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".apk")) {
      toast.error("Нужен файл установщика");
      return;
    }
    setBusy(true);
    const started = performance.now();
    try {
      await call({
        op: "begin",
        versionCode: Number(versionCode),
        versionName: versionName.trim(),
        changelog: notes,
        force,
        size: file.size,
      });
      let offset = 0;
      while (offset < file.size) {
        const index = Math.floor(offset / CHUNK);
        const raw = new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer());
        let received = offset;
        let sent = false;
        for (let attempt = 0; attempt < 4 && !sent; attempt += 1) {
          try {
            const row = await call({ op: "chunk", index, data: bytesToBase64(raw) });
            received = typeof row.received === "number" ? row.received : offset + raw.length;
            sent = true;
          } catch (error) {
            if (attempt === 3) throw error;
          }
        }
        if (received <= offset) throw new Error("Файл не сдвинулся с места");
        offset = received;
        const seconds = Math.max(0.25, (performance.now() - started) / 1000);
        setMeter({ name: file.name, ratio: Math.min(1, offset / file.size), loaded: offset, total: file.size, speed: offset / seconds });
      }
      const next = await call({ op: "finish" });
      setInfo(next);
      setVersionCode(String(next.nextCode));
      setVersionName("");
      setNotes("");
      setForce(false);
      setFile(null);
      toast("Обновление опубликовано");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Файл не опубликован");
    } finally {
      setMeter(null);
      setBusy(false);
    }
  }

  async function remove() {
    if (busy || !info?.current) return;
    if (!window.confirm("Убрать это обновление? Телефон перестанет его предлагать.")) return;
    setBusy(true);
    try {
      const next = await call({ op: "drop" });
      setInfo(next);
      setVersionCode(String(next.nextCode));
      toast("Обновление убрано");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось убрать");
    } finally {
      setBusy(false);
    }
  }

  if (!info) return <PageLoader />;
  const current = info.current;

  return (
    <div className="mt-4">
      <p className="text-sm text-muted">Телефон смотрит обновление при запуске и при возврате в приложение, не чаще раза в 6 часов. Предлагает его, только если номер больше установленного.</p>
      {current ? (
        <section className="mt-3 rounded-[1.4rem] border border-line bg-elev p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="font-serif text-2xl tracking-tight">
              {current.versionName}
              <span className="ml-2 text-sm text-faint">№ {current.versionCode}</span>
            </h4>
            <p className="text-xs text-faint">{sizeLabel(current.size)}</p>
          </div>
          <p className="mt-1 truncate text-xs text-faint">{current.fileName}</p>
          {current.force ? <p className="mt-2 text-xs text-muted">Без кнопки «Позже»</p> : null}
          {current.changelog ? <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{current.changelog}</p> : <p className="mt-3 text-sm text-faint">Текст обновления пуст.</p>}
          <button type="button" disabled={busy} className="press mt-3 h-10 rounded-xl border border-line px-3 text-sm text-danger disabled:opacity-40" onClick={() => void remove()}>
            Удалить
          </button>
        </section>
      ) : (
        <p className="mt-3 text-sm text-muted">Сейчас обновления нет. Загрузите установщик.</p>
      )}
      <section className="mt-3 rounded-[1.4rem] border border-line bg-bg p-4">
        <h4 className="text-sm font-medium">Новое обновление</h4>
        <label className="mt-3 block text-xs text-faint">
          Версия
          <input className="field mt-1" value={versionName} placeholder="2.4.0" maxLength={20} onChange={(event) => setVersionName(event.target.value)} />
        </label>
        <label className="mt-3 block text-xs text-faint">
          Номер, больше текущего
          <input className="field mt-1" inputMode="numeric" value={versionCode} maxLength={7} onChange={(event) => setVersionCode(event.target.value.replace(/\D/g, "").slice(0, 7))} />
        </label>
        <label className="mt-3 block text-xs text-faint">
          Что изменилось
          <textarea className="field mt-1 min-h-28 resize-y py-2" value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
          Без кнопки «Позже»
        </label>
        <label className="press mt-3 flex h-11 cursor-pointer items-center justify-center rounded-xl border border-line px-3 text-sm">
          {file ? file.name : "Выбрать установщик"}
          <input
            type="file"
            accept=".apk,application/vnd.android.package-archive"
            className="hidden"
            onChange={(event) => {
              const next = event.target.files?.[0] ?? null;
              event.target.value = "";
              setFile(next);
            }}
          />
        </label>
        {meter ? (
          <div className="mt-3">
            <UploadMeter view={meter} />
          </div>
        ) : null}
        <button type="button" disabled={busy} className="press mt-3 h-11 w-full rounded-2xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40" onClick={() => void publish()}>
          Опубликовать
        </button>
      </section>
    </div>
  );
}
