import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { UploadMeter, sizeLabel, type UploadView } from "@/components/yaronetic/upload-meter";
import { getBearerToken } from "@/lib/auth/client";
import { useTx } from "@/lib/lang";

const CHUNK = 512 * 1024;

type Platform = "android" | "windows";

type ReleaseView = {
  source: "live" | "builtin" | "none";
  versionCode: number;
  versionName: string;
  fileName: string;
  changelog: string;
  force: boolean;
  size: number;
};

type AndroidStatus = { current: ReleaseView | null; nextCode: number };
type WindowsCurrent = { version: string; fileName: string; changelog: string; size: number; publishedAt: string | null; url: string };
type WindowsStatus = { platform: "windows"; current: WindowsCurrent | null };

async function call(platform: Platform, body?: Record<string, unknown>) {
  const headers = new Headers();
  if (body) headers.set("content-type", "application/json");
  const token = getBearerToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const query = platform === "windows" && !body ? "?platform=windows" : "";
  const payload = body ? { ...body, ...(platform === "windows" ? { platform: "windows" } : {}) } : undefined;
  const res = await fetch(`/api/app-release${query}`, {
    method: payload ? "POST" : "GET",
    credentials: "same-origin",
    headers,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const parsed = (await res.json().catch(() => ({}))) as AndroidStatus & WindowsStatus & { received?: number; message?: string };
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
  const tx = useTx();
  const [platform, setPlatform] = useState<Platform>("android");
  const [android, setAndroid] = useState<AndroidStatus | null>(null);
  const [windows, setWindows] = useState<WindowsStatus | null>(null);
  const [versionName, setVersionName] = useState("");
  const [versionCode, setVersionCode] = useState("");
  const [notes, setNotes] = useState("");
  const [force, setForce] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [signature, setSignature] = useState("");
  const [busy, setBusy] = useState(false);
  const [meter, setMeter] = useState<UploadView | null>(null);

  useEffect(() => {
    let dead = false;
    void call(platform)
      .then((row) => {
        if (dead) return;
        if (platform === "windows") setWindows(row as WindowsStatus);
        else {
          const next = row as AndroidStatus;
          setAndroid(next);
          setVersionCode(String(next.nextCode));
        }
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Обновление не открылось"));
    return () => {
      dead = true;
    };
  }, [platform]);

  async function sendFile() {
    if (!file) return;
    await call(platform, {
      op: "begin",
      versionCode: Number(versionCode),
      versionName: versionName.trim(),
      version: versionName.trim(),
      changelog: notes,
      force,
      size: file.size,
      signature,
    });
    let offset = 0;
    const started = performance.now();
    while (offset < file.size) {
      const index = Math.floor(offset / CHUNK);
      const raw = new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer());
      let received = offset;
      let sent = false;
      for (let attempt = 0; attempt < 4 && !sent; attempt += 1) {
        try {
          const row = await call(platform, { op: "chunk", index, data: bytesToBase64(raw) });
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
  }

  async function publish() {
    if (busy) return;
    if (!file) {
      toast(tx({ ru: "Сначала выберите файл", en: "Choose the file first", kk: "Алдымен файлды таңдаңыз" }));
      return;
    }
    if (platform === "android" && !file.name.toLowerCase().endsWith(".apk")) {
      toast.error(tx({ ru: "Нужен файл установщика", en: "An installer file is required", kk: "Орнатқыш файл керек" }));
      return;
    }
    if (platform === "windows" && !file.name.toLowerCase().endsWith(".exe")) {
      toast.error(tx({ ru: "Нужен файл .exe", en: "An .exe file is required", kk: ".exe файлы керек" }));
      return;
    }
    if (platform === "windows" && !signature.trim()) {
      toast.error(tx({ ru: "Нужен файл подписи .sig", en: "The .sig file is required", kk: ".sig файлы керек" }));
      return;
    }
    setBusy(true);
    try {
      await sendFile();
      const next = await call(platform, { op: "finish" });
      if (platform === "windows") setWindows(next as WindowsStatus);
      else {
        setAndroid(next as AndroidStatus);
        setVersionCode(String((next as AndroidStatus).nextCode));
      }
      setVersionName("");
      setNotes("");
      setForce(false);
      setFile(null);
      setSignature("");
      toast(tx({ ru: "Обновление опубликовано", en: "Update published", kk: "Жаңарту жарияланды" }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Файл не опубликован");
    } finally {
      setMeter(null);
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    const question = platform === "windows"
      ? tx({ ru: "Снять Windows-версию? Приложение перестанет её предлагать.", en: "Remove the Windows release? The app will stop offering it.", kk: "Windows нұсқасын алу керек пе?" })
      : "Убрать это обновление? Телефон перестанет его предлагать.";
    if (!window.confirm(question)) return;
    setBusy(true);
    try {
      const next = await call(platform, { op: "drop" });
      if (platform === "windows") setWindows(next as WindowsStatus);
      else {
        setAndroid(next as AndroidStatus);
        setVersionCode(String((next as AndroidStatus).nextCode));
      }
      toast(tx({ ru: "Обновление убрано", en: "Update removed", kk: "Жаңарту алынды" }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось убрать");
    } finally {
      setBusy(false);
    }
  }

  if ((platform === "android" && !android) || (platform === "windows" && !windows)) return <PageLoader />;
  const current = android?.current;

  return (
    <div className="mt-4">
      <div className="grid grid-cols-2 gap-1 rounded-2xl border border-line bg-subtle p-1">
        {(["android", "windows"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={platform === item}
            className={`press h-11 rounded-xl text-sm font-medium ${platform === item ? "bg-elev text-fg shadow-sm" : "text-muted"}`}
            onClick={() => {
              setPlatform(item);
              setFile(null);
              setSignature("");
              setMeter(null);
            }}
          >
            {item === "android" ? "Android" : "Windows"}
          </button>
        ))}
      </div>
      {platform === "android" ? (
        <>
          <p className="mt-3 text-sm text-muted">Телефон смотрит обновление при запуске и при возврате в приложение, не чаще раза в 6 часов. Предлагает его, только если номер больше установленного. Файл хранится в объектном хранилище, не на диске сайта.</p>
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
              <input type="file" accept=".apk,application/vnd.android.package-archive" className="hidden" onChange={(event) => { const next = event.target.files?.[0] ?? null; event.target.value = ""; setFile(next); }} />
            </label>
            {meter ? <div className="mt-3"><UploadMeter view={meter} /></div> : null}
            <button type="button" disabled={busy} className="press mt-3 h-11 w-full rounded-2xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40" onClick={() => void publish()}>
              Опубликовать
            </button>
          </section>
        </>
      ) : (
        <WindowsForm
          info={windows}
          busy={busy}
          versionName={versionName}
          notes={notes}
          file={file}
          signature={signature}
          meter={meter}
          onVersion={setVersionName}
          onNotes={setNotes}
          onFile={setFile}
          onSignature={setSignature}
          onPublish={() => void publish()}
          onRemove={() => void remove()}
        />
      )}
    </div>
  );
}

function WindowsForm(props: {
  info: WindowsStatus | null;
  busy: boolean;
  versionName: string;
  notes: string;
  file: File | null;
  signature: string;
  meter: UploadView | null;
  onVersion: (value: string) => void;
  onNotes: (value: string) => void;
  onFile: (file: File | null) => void;
  onSignature: (value: string) => void;
  onPublish: () => void;
  onRemove: () => void;
}) {
  const tx = useTx();
  const current = props.info?.current;
  const when = current?.publishedAt ? new Date(current.publishedAt).toLocaleString() : "";
  return (
    <>
      <p className="mt-3 text-sm text-muted">
        {tx({
          ru: "Приложение Windows проверяет обновление через 30 секунд после запуска и затем каждые 4 часа. Установщик и подпись лежат в объектном хранилище, не на диске сайта и не в Мегадиске.",
          en: "The Windows app checks for an update 30 seconds after launch and then every 4 hours. The installer and signature stay in object storage, not on the site disk or MegaDisk.",
          kk: "Windows қолданбасы жаңартуды 30 секундтан кейін және әр 4 сағат сайын тексереді. Файл сайт дискісінде емес.",
        })}
      </p>
      {current ? (
        <section className="mt-3 rounded-[1.4rem] border border-line bg-elev p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="font-serif text-2xl tracking-tight">{current.version}</h4>
            <p className="text-xs text-faint">{sizeLabel(current.size)}</p>
          </div>
          <p className="mt-1 truncate text-xs text-faint">{current.fileName}</p>
          {when ? <p className="mt-1 text-xs text-faint">{when}</p> : null}
          <a className="mt-2 inline-flex text-sm text-accent" href={current.url}>{tx({ ru: "Скачать установщик", en: "Download the installer", kk: "Орнатқышты жүктеу" })}</a>
          {current.changelog ? <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{current.changelog}</p> : null}
          <button type="button" disabled={props.busy} className="press mt-3 h-11 rounded-xl border border-line px-3 text-sm text-danger disabled:opacity-40" onClick={props.onRemove}>
            {tx({ ru: "Снять", en: "Remove", kk: "Алу" })}
          </button>
        </section>
      ) : (
        <p className="mt-3 text-sm text-muted">{tx({ ru: "Windows-версии пока нет.", en: "No Windows release yet.", kk: "Windows нұсқасы әлі жоқ." })}</p>
      )}
      <section className="mt-3 rounded-[1.4rem] border border-line bg-bg p-4">
        <h4 className="text-sm font-medium">{tx({ ru: "Новая версия Windows", en: "New Windows version", kk: "Жаңа Windows нұсқасы" })}</h4>
        <p className="mt-2 text-xs text-faint">
          {tx({
            ru: "Файлы берутся из артефакта сборки GitHub Actions vvvion-space-desktop-windows-x64: VVVion Space_X.Y.Z_x64-setup.exe и VVVion Space_X.Y.Z_x64-setup.exe.sig.",
            en: "Use the GitHub Actions artifact vvvion-space-desktop-windows-x64: the setup .exe and its .sig.",
            kk: "GitHub Actions артефактісіндегі .exe және .sig файлдарын жүктеңіз.",
          })}
        </p>
        <label className="mt-3 block text-xs text-faint">
          {tx({ ru: "Версия", en: "Version", kk: "Нұсқа" })}
          <input className="field mt-1" value={props.versionName} placeholder="0.2.0" maxLength={20} onChange={(event) => props.onVersion(event.target.value)} />
        </label>
        <label className="mt-3 block text-xs text-faint">
          {tx({ ru: "Что нового", en: "What’s new", kk: "Не жаңалық" })}
          <textarea className="field mt-1 min-h-28 resize-y py-2" value={props.notes} maxLength={2000} onChange={(event) => props.onNotes(event.target.value)} />
        </label>
        <label className="press mt-3 flex h-11 cursor-pointer items-center justify-center rounded-xl border border-line px-3 text-sm">
          {props.file ? props.file.name : tx({ ru: "Выбрать установщик .exe", en: "Choose the .exe installer", kk: ".exe орнатқышты таңдау" })}
          <input type="file" accept=".exe" className="hidden" onChange={(event) => { props.onFile(event.target.files?.[0] ?? null); event.target.value = ""; }} />
        </label>
        <label className="press mt-2 flex h-11 cursor-pointer items-center justify-center rounded-xl border border-line px-3 text-sm">
          {props.signature ? tx({ ru: "Подпись выбрана", en: "Signature selected", kk: "Қолтаңба таңдалды" }) : tx({ ru: "Выбрать подпись .sig", en: "Choose the .sig file", kk: ".sig қолтаңбаны таңдау" })}
          <input
            type="file"
            accept=".sig,text/plain"
            className="hidden"
            onChange={(event) => {
              const next = event.target.files?.[0];
              event.target.value = "";
              if (!next) return;
              void next.text().then((text) => props.onSignature(text)).catch(() => toast.error(tx({ ru: "Подпись не прочиталась", en: "Could not read the signature", kk: "Қолтаңба оқылмады" })));
            }}
          />
        </label>
        {props.meter ? <div className="mt-3"><UploadMeter view={props.meter} /></div> : null}
        <button type="button" disabled={props.busy} className="press mt-3 h-11 w-full rounded-2xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40" onClick={props.onPublish}>
          {tx({ ru: "Опубликовать", en: "Publish", kk: "Жариялау" })}
        </button>
      </section>
    </>
  );
}
