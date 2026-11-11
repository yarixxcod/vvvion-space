import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Copy, Eye, EyeOff, Info, LogOut, Send, UserRound, Volume2, VolumeX } from "lucide-react";
import { BackButton } from "@/components/yaronetic/back-button";
import { toast } from "sonner";
import { authClient, rememberBearer, signOut } from "@/lib/auth/client";
import { hasGateSessionMarker } from "@/lib/auth/gate-session-marker";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { clearAvatar, saveAvatar } from "@/lib/social/profile";
import { PersonFace, refreshFaceMarks } from "@/components/yaronetic/person-face";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { MailAccount } from "@/components/yaronetic/mail-account";
import { HumanCheck } from "@/components/yaronetic/human-check";
import { forgetLocalChats } from "@/lib/ai/db";
import { changeAccountPassword } from "@/lib/mail/codes";
import { listOwnSessions, revokeEverySession, revokeOwnSession, type OwnSession } from "@/lib/auth/sessions";
import { getPremium, type PremiumState } from "@/lib/social/premium";
import { getBank } from "@/lib/social/bank";
import { PurchaseSheet } from "@/components/yaronetic/purchase-sheet";
import { TopupSheet } from "@/components/yaronetic/topup-sheet";
import { VerifyMailButton } from "@/components/yaronetic/verify-mail";
import { fmtRubApprox, fmtVub } from "@/lib/pay/format";
import { AboutSheet } from "@/components/yaronetic/about-pages";
import { ui } from "@/lib/i18n";
import { LangSwitch, useLang, useTx } from "@/lib/lang";
import { useReleaseFlag } from "@/lib/release";
import { HandleCard } from "@/components/yaronetic/handle-card";
import { getProfileFacts, saveProfileFacts } from "@/lib/social/profile-facts";
import { PlaceFields } from "@/components/yaronetic/places";
import { playSound, setSoundPack, setSoundsEnabled, soundPack, soundsEnabled, type SoundPack } from "@/lib/sounds";
import { haptic } from "@/lib/haptic";
import { getTelegramLink, startTelegramLink, stopTelegramLink, type TelegramLinkState } from "@/lib/social/telegram";
import { getAchievements, type AchievementItem } from "@/lib/social/achievements";
import { PushSettingsCard } from "@/components/yaronetic/push-settings";

function authText(error: { message?: string; code?: string } | null | undefined, fallback: string) {
  const blob = `${error?.code ?? ""} ${error?.message ?? ""}`;
  if (/invalid password|INVALID_PASSWORD/i.test(blob)) return "Неверный текущий пароль";
  if (/too short|TOO_SHORT/i.test(blob)) return "Пароль должен быть не короче 8 символов";
  if (/too long|TOO_LONG/i.test(blob)) return "Пароль слишком длинный";
  return fallback;
}

async function fileToJpeg(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Выберите фотографию");
  if (file.size > 8_000_000) throw new Error("Файл больше 8 МБ");
  const bitmap = await createImageBitmap(file);
  const max = 256;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось обработать фото");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("Не удалось обработать фото");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

export function UserButton({ compact = false, onTheme, theme }: { compact?: boolean; onTheme?: () => void; theme?: "dark" | "light" } = {}) {
  const user = useCurrentUser();
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<"profile" | "about" | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [sound, setSound] = useState(true);
  const release = useReleaseFlag();
  useEffect(() => {
    const pull = () => setSound(soundsEnabled());
    pull();
    window.addEventListener("vvvion-sounds", pull);
    return () => window.removeEventListener("vvvion-sounds", pull);
  }, []);
  if (!user) return null;
  const label = user.displayName ?? user.primaryEmail ?? ui(lang, "member");
  const email = user.primaryEmail;
  const gate = typeof window !== "undefined" && hasGateSessionMarker();
  return (
    <>
      <div className="relative">
        <button
          type="button"
          className={
            compact
              ? "press grid size-11 place-items-center rounded-full border border-line bg-elev"
              : `press flex max-w-full min-w-0 items-center gap-2 rounded-2xl border bg-elev py-1 pr-3 pl-1 ${open ? "border-accent" : "border-line"}`
          }
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="relative shrink-0">
            <PersonFace name={label} image={user.profileImageUrl} size={36} userId={user.id} />
            {release && !compact ? (
              <span className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border border-bg bg-accent text-[12px] font-semibold leading-none text-accent-fg" aria-hidden="true">
                !
              </span>
            ) : null}
            {release && compact ? <span className="absolute top-0 right-0 size-2 rounded-full bg-accent" aria-hidden="true" /> : null}
          </span>
          {compact ? null : <span className="min-w-0 truncate text-sm font-medium">{label}</span>}
        </button>
        {open ? (
          <>
            <button type="button" className="fixed inset-0 z-20 cursor-default" aria-label={ui(lang, "closeMenu")} onClick={() => setOpen(false)} />
            <div role="menu" className="absolute top-12 right-0 z-30 w-64 rounded-2xl border border-line bg-elev p-1 shadow-[var(--shadow)]">
              <LangSwitch />
              {onTheme ? (
                <button
                  type="button"
                  role="menuitem"
                  className="press flex h-11 w-full items-center rounded-xl px-3 text-left text-sm"
                  onClick={() => {
                    setOpen(false);
                    onTheme();
                  }}
                >
                  {theme === "dark" ? "Светлая тема" : "Тёмная тема"}
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="press flex h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm"
                onClick={() => {
                  setOpen(false);
                  setSheet("profile");
                }}
              >
                <UserRound className="size-4 text-muted" />
                {ui(lang, "menuProfile")}
              </button>
              <button
                type="button"
                role="menuitem"
                className="press flex h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm"
                aria-pressed={sound}
                onClick={() => {
                  const next = !soundsEnabled();
                  setSoundsEnabled(next);
                  if (next) playSound("notice", true);
                }}
              >
                {sound ? <Volume2 className="size-4 text-muted" /> : <VolumeX className="size-4 text-muted" />}
                {sound ? ui(lang, "soundOn") : ui(lang, "soundOff")}
              </button>
              <button
                type="button"
                role="menuitem"
                className="press flex h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm"
                onClick={() => {
                  setOpen(false);
                  setSheet("about");
                }}
              >
                <Info className="size-4 text-muted" />
                {ui(lang, "about")}
                {release ? <span className="ml-auto text-sm font-semibold text-accent">!</span> : null}
              </button>
              {gate ? null : (
                <button
                  type="button"
                  role="menuitem"
                  disabled={signingOut}
                  className="press flex h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm text-danger disabled:opacity-40"
                  onClick={() => {
                    setSigningOut(true);
                    signOut().catch(() => setSigningOut(false));
                  }}
                >
                  <LogOut className="size-4" />
                  {ui(lang, "signOut")}
                </button>
              )}
            </div>
          </>
        ) : null}
      </div>
      {sheet === "profile" ? (
        <ProfileSheet label={label} email={email} image={user.profileImageUrl} userId={user.id} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === "about" ? <AboutSheet onClose={() => setSheet(null)} /> : null}
    </>
  );
}

function ProfileSheet({
  label,
  email,
  image,
  userId,
  onClose,
}: {
  label: string;
  email: string | null;
  image: string | null;
  userId: string;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(label);
  const [photo, setPhoto] = useState(image);
  const [shownEmail, setShownEmail] = useState(email ?? "");
  const [verified, setVerified] = useState<boolean | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [proof, setProof] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [deletePassword, setDeletePassword] = useState("");
  const [showNext, setShowNext] = useState(false);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const saved = await saveAvatar({ data: { data: await fileToJpeg(file) } });
      const { error } = await authClient.updateUser({ image: saved.image });
      if (error) throw new Error(authText(error, "Не удалось показать фото в сессии"));
      setPhoto(saved.image);
      toast("Фото сохранено");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить фото");
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    setBusy(true);
    try {
      await clearAvatar();
      const { error } = await authClient.updateUser({ image: null });
      if (error) throw new Error(authText(error, "Не удалось убрать фото"));
      setPhoto(null);
      toast("Фото убрано");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось убрать фото");
    } finally {
      setBusy(false);
    }
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();
    const next = name.trim().slice(0, 48);
    if (next.length < 1) {
      toast.error("Напишите имя");
      return;
    }
    setBusy(true);
    try {
      const { error } = await authClient.updateUser({ name: next });
      if (error) throw new Error(authText(error, "Не удалось сохранить имя"));
      setName(next);
      toast("Имя сохранено");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить имя");
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (nextPassword.length < 8) {
      toast.error("Новый пароль должен быть не короче 8 символов");
      return;
    }
    if (!proof) {
      toast.error("Подтвердите, что вы не робот.");
      return;
    }
    setBusy(true);
    try {
      await changeAccountPassword({ data: { current: currentPassword, next: nextPassword, proof } });
      setCurrentPassword("");
      setNextPassword("");
      setProof("");
      rememberBearer(null);
      toast("Пароль изменён. Войдите заново — остальные входы закрыты.");
      await signOut("/login").catch(() => {
        window.location.href = "/login";
      });
    } catch (err) {
      setProof("");
      setResetKey((value) => value + 1);
      toast.error(err instanceof Error ? err.message : "Не удалось сменить пароль");
    } finally {
      setBusy(false);
    }
  }

  async function removeAccount(event: FormEvent) {
    event.preventDefault();
    if (!deletePassword) {
      toast.error("Введите пароль, чтобы удалить аккаунт");
      return;
    }
    if (!window.confirm("Удалить аккаунт навсегда? Диалоги, книги и переписки этого входа исчезнут.")) return;
    setBusy(true);
    try {
      const { unregisterPushToken } = await import("@/lib/app-bridge");
      await unregisterPushToken().catch(() => undefined);
      const { error } = await authClient.deleteUser({ password: deletePassword });
      if (error) throw new Error(authText(error, "Не удалось удалить аккаунт"));
      rememberBearer(null);
      await forgetLocalChats().catch(() => undefined);
      window.location.href = "/";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить аккаунт");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45">
      <button type="button" className="absolute inset-0" aria-label="Закрыть профиль" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-line bg-bg">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-bg/90 px-4 py-3 backdrop-blur">
          <div className="flex min-w-0 items-center gap-1">
            <BackButton onClick={onClose} label="Назад" />
            <h2 className="truncate font-serif text-2xl tracking-tight">Профиль</h2>
          </div>
          <button type="button" className="press hidden h-10 rounded-xl px-3 text-sm text-muted md:inline-flex" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div className="px-4 pt-6 pb-10">
          <div className="flex flex-col items-center text-center">
            <PersonFace name={name || label} image={photo} size={96} userId={userId} />
            <p className="mt-3 font-serif text-3xl tracking-tight">{name.trim() || label}</p>
            {shownEmail ? (
              <button
                type="button"
                className="press mt-1 inline-flex max-w-full items-center gap-1.5 text-sm text-muted"
                onClick={() => {
                  navigator.clipboard.writeText(shownEmail).then(
                    () => toast("Почта скопирована"),
                    () => toast(shownEmail),
                  );
                }}
              >
                <span className="truncate">{shownEmail}</span>
                <Copy className="size-3.5 shrink-0" />
              </button>
            ) : null}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                disabled={busy}
                className="press h-10 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40"
                onClick={() => fileRef.current?.click()}
              >
                Сменить фото
              </button>
              {photo ? (
                <button type="button" disabled={busy} className="press h-10 rounded-xl border border-line px-3 text-sm disabled:opacity-40" onClick={() => void removePhoto()}>
                  Убрать
                </button>
              ) : null}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void upload(file);
              }}
            />
          </div>

          <form className="mt-6 space-y-2 rounded-3xl border border-line bg-elev p-4" onSubmit={(event) => void saveName(event)}>
            <p className="text-sm font-medium">Как вас видят</p>
            <p className="text-xs text-faint">Это имя в круге, в сообщениях и в заявках.</p>
            <label className="block text-xs text-faint">
              Имя
              <input className="field mt-1" value={name} maxLength={48} onChange={(event) => setName(event.target.value)} />
            </label>
            <button type="submit" disabled={busy} className="press h-11 w-full rounded-2xl border border-line px-3 text-sm disabled:opacity-40">
              Сохранить имя
            </button>
          </form>
          <HandleCard />

          <FactsCard />
          <AchievementsCard />
          <SoundCard />
          <PushSettingsCard />
          <MailAccount
            onStatus={(value) => {
              setVerified(value);
              if (value) window.dispatchEvent(new Event("vvvion-achievements"));
            }}
            onEmail={setShownEmail}
          />
          <PremiumCard verified={verified} />
          <TelegramCard />

          <form className="mt-4 space-y-2 rounded-3xl border border-line bg-elev p-4" onSubmit={(event) => void savePassword(event)}>
            <p className="text-sm font-medium">Пароль</p>
            {verified === false ? (
              <p className="text-xs leading-relaxed text-faint">Смена пароля откроется после подтверждения почты.</p>
            ) : (
              <>
                <p className="text-xs text-faint">После смены все устройства выйдут из аккаунта, включая это.</p>
                <input
                  className="field"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Текущий пароль"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
                <div className="relative">
                  <input
                    className="field pr-12"
                    type={showNext ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Новый пароль"
                    value={nextPassword}
                    onChange={(event) => setNextPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="press absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-xl text-muted"
                    aria-label={showNext ? "Скрыть пароль" : "Показать пароль"}
                    onClick={() => setShowNext((value) => !value)}
                  >
                    {showNext ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <HumanCheck resetKey={resetKey} onPayload={setProof} />
                <button type="submit" disabled={busy || verified === null} className="press h-11 w-full rounded-2xl border border-line px-3 text-sm disabled:opacity-40">
                  Сменить пароль
                </button>
              </>
            )}
          </form>

          <SessionsCard />

          <form className="mt-4 space-y-2 rounded-3xl border border-danger/30 bg-elev p-4" onSubmit={(event) => void removeAccount(event)}>
            <p className="text-sm font-medium text-danger">Удалить аккаунт</p>
            <p className="text-xs text-faint">Пропадёт вход, история чата, полка и переписки. Это нельзя отменить.</p>
            <input
              className="field"
              type="password"
              autoComplete="current-password"
              placeholder="Пароль для подтверждения"
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)}
            />
            <button type="submit" disabled={busy} className="press h-11 w-full rounded-2xl bg-danger px-3 text-sm font-medium text-white disabled:opacity-40">
              Удалить навсегда
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function SessionsCard() {
  const [rows, setRows] = useState<OwnSession[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void listOwnSessions()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  async function drop(id: string) {
    setBusy(true);
    try {
      const result = await revokeOwnSession({ data: id });
      if (result.current) {
        rememberBearer(null);
        await signOut("/login").catch(() => {
          window.location.href = "/login";
        });
        return;
      }
      setRows((current) => current?.filter((row) => row.id !== id) ?? []);
      toast("Вход закрыт");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось закрыть вход");
    } finally {
      setBusy(false);
    }
  }
  async function dropAll() {
    if (!window.confirm("Выйти на всех устройствах, включая это?")) return;
    setBusy(true);
    try {
      await revokeEverySession();
      rememberBearer(null);
      toast("Все входы закрыты");
      await signOut("/login").catch(() => {
        window.location.href = "/login";
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось закрыть входы");
      setBusy(false);
    }
  }
  return (
    <section className="mt-4 space-y-2 rounded-3xl border border-line bg-elev p-4">
      <p className="text-sm font-medium">Входы</p>
      <p className="text-xs text-faint">Устройства, где этот аккаунт сейчас открыт.</p>
      {rows === null ? <PageLoader compact /> : null}
      {rows?.length === 0 ? <p className="text-xs text-faint">Других входов не видно.</p> : null}
      <ul className="space-y-2">
        {rows?.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm">{row.label}{row.current ? " · этот" : ""}</p>
              <p className="text-xs text-faint">{row.at ? new Date(row.at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</p>
            </div>
            <button type="button" disabled={busy} className="press h-9 shrink-0 rounded-xl border border-line px-2 text-xs disabled:opacity-40" onClick={() => void drop(row.id)}>
              Выйти
            </button>
          </li>
        ))}
      </ul>
      <button type="button" disabled={busy} className="press h-10 w-full rounded-xl border border-line text-sm disabled:opacity-40" onClick={() => void dropAll()}>
        Выйти везде
      </button>
    </section>
  );
}

function PremiumCard({ verified }: { verified: boolean | null }) {
  const [state, setState] = useState<PremiumState | null>(null);
  const [balance, setBalance] = useState(0);
  const [open, setOpen] = useState(false);
  const [fill, setFill] = useState(false);
  const [need, setNeed] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);
  function reload() {
    void getPremium().then(setState).catch(() => setState(null));
    void getBank().then((bank) => setBalance(bank.balance)).catch(() => undefined);
  }
  useEffect(() => {
    reload();
  }, []);
  const until = state?.until ? new Date(state.until) : null;
  const untilText = until && !Number.isNaN(until.getTime()) ? until.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : "";
  return (
    <section className="mt-4 overflow-hidden rounded-3xl border border-line bg-elev">
      <div className="border-b border-line bg-[color-mix(in_oklab,#6e5ad6_18%,var(--elev))] px-4 py-4">
        <p className="text-xs tracking-[0.22em] text-muted">VVVION PREMIUM</p>
        <h3 className="mt-1 font-serif text-3xl tracking-tight">{state?.active ? "Действует" : "30 дней"}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {state?.active
            ? `Подписка до ${untilText}. Продлить можно в магазине или здесь.`
            : "Пока подписка действует: дневной лимит вдвое выше, если он задан, плюс 500 МБ на диске и все персонажи без отдельной покупки."}
        </p>
        <p className="mt-3 font-serif text-2xl tabular-nums">{fmtVub(state?.price ?? 2500)}</p>
        <p className="text-xs text-muted">{fmtRubApprox(state?.price ?? 2500)}</p>
      </div>
      <ul className="space-y-2 px-4 py-4 text-sm leading-relaxed text-muted">
        <li>Двойной дневной лимит запросов и токенов.</li>
        <li>500 МБ на диске, пока подписка не кончилась.</li>
        <li>Персонажи из магазина доступны без покупки.</li>
        <li>Сиреневая окантовка аватарки в круге.</li>
      </ul>
      <div className="px-4 pb-4">
        {verified === false ? (
          <VerifyMailButton onVerified={reload} />
        ) : (
          <button
            type="button"
            disabled={busy || state === null}
            className="press min-h-11 w-full rounded-2xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40"
            onClick={() => setOpen(true)}
          >
            {state?.active ? "Продлить" : "Открыть"}
          </button>
        )}
      </div>
      <PurchaseSheet
        open={open && Boolean(state)}
        title="Premium"
        price={state?.price ?? 2500}
        balance={balance}
        detail={`Подписка продлится на ${state?.days ?? 30} дней.`}
        busy={busy}
        onClose={() => setOpen(false)}
        onTopup={(short) => {
          setOpen(false);
          setNeed(short);
          setFill(true);
        }}
        onConfirm={() => {
          if (!state) return;
          if (!key.current) key.current = crypto.randomUUID();
          setBusy(true);
          void fetch("/api/shop/purchase", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sku: "premium", idempotencyKey: key.current }),
          })
            .then(async (res) => {
              const body = (await res.json().catch(() => ({}))) as { message?: string };
              if (!res.ok) throw new Error(body.message || "Подписка недоступна");
              key.current = null;
              reload();
              refreshFaceMarks();
              toast("Подписка открыта");
              setOpen(false);
            })
            .catch((err: unknown) => {
              toast.error(err instanceof Error ? err.message : "Подписка недоступна");
            })
            .finally(() => setBusy(false));
        }}
      />
      <TopupSheet open={fill} needVub={need} returnTo="shop" onClose={() => setFill(false)} onPaid={reload} />
    </section>
  );
}

function maskBirth(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
}

function typeBirth(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

function isoBirth(mask: string): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(mask);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

function FactsCard() {
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [birth, setBirth] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getProfileFacts()
      .then((row) => {
        setCountry(row.country);
        setCity(row.city);
        setBirth(maskBirth(row.birthDate));
      })
      .catch(() => undefined);
  }, []);

  return (
    <form
      className="mt-4 space-y-2 rounded-3xl border border-line bg-elev p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const stored = birth.trim() ? isoBirth(birth) : "";
        if (birth.trim() && !stored) {
          toast.error("Дата: ДД.ММ.ГГГГ");
          return;
        }
        setBusy(true);
        void saveProfileFacts({ data: { country, city, birthDate: stored } })
          .then(() => {
            toast("Данные сохранены");
            window.dispatchEvent(new Event("vvvion-achievements"));
          })
          .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Не удалось сохранить"))
          .finally(() => setBusy(false));
      }}
    >
      <p className="text-sm font-medium">О себе</p>
      <p className="text-[13px] text-muted">Страна, город и дата рождения.</p>
      <PlaceFields country={country} city={city} onCountry={setCountry} onCity={setCity} />
      <label className="block text-xs text-faint">
        Дата рождения
        <input
          className="field mt-1"
          inputMode="numeric"
          autoComplete="bday"
          placeholder="ДД.ММ.ГГГГ"
          value={birth}
          onChange={(event) => setBirth(typeBirth(event.target.value))}
        />
      </label>
      <button type="submit" disabled={busy} className="press h-11 w-full rounded-2xl border border-line px-3 text-sm disabled:opacity-40">
        Сохранить
      </button>
    </form>
  );
}

function AchievementsCard() {
  const [items, setItems] = useState<AchievementItem[] | null>(null);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [earned, setEarned] = useState(0);

  useEffect(() => {
    const pull = () => {
      void getAchievements()
        .then((row) => {
          setItems(row.items);
          setDone(row.done);
          setTotal(row.total);
          setEarned(row.earned);
        })
        .catch(() => setItems([]));
    };
    pull();
    window.addEventListener("vvvion-achievements", pull);
    return () => window.removeEventListener("vvvion-achievements", pull);
  }, []);

  const list = items ?? [];
  const width = total ? Math.round((done / total) * 100) : 0;
  return (
    <section className="mt-4 rounded-3xl border border-line bg-elev p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">Достижения</p>
        <p className="text-xs tabular-nums text-faint">{items ? `${done} из ${total}` : "Считаем…"}</p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={width} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
      </div>
      <p className="mt-2 text-xs text-faint">{earned ? `${earned} вублей на карте` : "За каждое — вубли на карту"}</p>
      <ul className="mt-3 space-y-2">
        {list.map((item) => (
          <li key={item.code} className="flex items-center gap-3">
            <span
              className={
                item.done
                  ? "grid size-8 shrink-0 place-items-center rounded-full bg-accent text-accent-fg"
                  : "grid size-8 shrink-0 place-items-center rounded-full border border-line text-xs tabular-nums text-faint"
              }
            >
              {item.done ? <Check className="size-4" /> : item.reward}
            </span>
            <div className="min-w-0 flex-1">
              <p className={item.done ? "text-sm" : "text-sm text-muted"}>{item.title}</p>
              <p className="text-xs text-faint">{item.text}</p>
            </div>
            <p className="shrink-0 text-xs tabular-nums text-faint">{item.done ? `+${item.reward}` : item.reward}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SoundCard() {
  const tx = useTx();
  const [on, setOn] = useState(true);
  const [pack, setPack] = useState<SoundPack>("soft");
  useEffect(() => {
    const pull = () => {
      setOn(soundsEnabled());
      setPack(soundPack());
    };
    pull();
    window.addEventListener("vvvion-sounds", pull);
    return () => window.removeEventListener("vvvion-sounds", pull);
  }, []);
  const choices: { id: SoundPack; label: string }[] = [
    { id: "soft", label: tx({ ru: "Мягкий", en: "Soft", kk: "Жұмсақ" }) },
    { id: "glass", label: tx({ ru: "Стекло", en: "Glass", kk: "Шыны" }) },
    { id: "wood", label: tx({ ru: "Дерево", en: "Wood", kk: "Ағаш" }) },
    { id: "pulse", label: tx({ ru: "Пульс", en: "Pulse", kk: "Пульс" }) },
    { id: "drop", label: tx({ ru: "Капля", en: "Drop", kk: "Тамшы" }) },
  ];
  return (
    <section className="mt-4 rounded-3xl border border-line bg-elev p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            {on ? <Volume2 className="size-4 text-muted" /> : <VolumeX className="size-4 text-muted" />}
            {tx({ ru: "Звук уведомлений", en: "Notification sound", kk: "Хабарлама дыбысы" })}
          </p>
          <p className="mt-1 text-xs text-faint">
            {tx({
              ru: "Короткие сигналы на тосты и новые сообщения. Можно сменить тембр или выключить совсем.",
              en: "Short cues for toasts and new messages. Change the tone or turn them off.",
              kk: "Тост пен жаңа хабарға қысқа дыбыс. Тембрді ауыстыруға немесе өшіруге болады.",
            })}
          </p>
        </div>
        <button
          type="button"
          aria-pressed={on}
          className={on ? "press h-10 shrink-0 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg" : "press h-10 shrink-0 rounded-xl border border-line px-3 text-sm"}
          onClick={() => {
            haptic("light");
            setSoundsEnabled(!on);
          }}
        >
          {on ? tx({ ru: "Вкл", en: "On", kk: "Қос" }) : tx({ ru: "Выкл", en: "Off", kk: "Өшір" })}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label={tx({ ru: "Тембр", en: "Tone", kk: "Тембр" })}>
        {choices.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={pack === item.id}
            className={pack === item.id ? "press h-9 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg" : "press h-9 rounded-xl border border-line px-3 text-sm"}
            onClick={() => {
              haptic("selection");
              setSoundPack(item.id);
              setPack(item.id);
              playSound("notice", true);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function TelegramCard() {
  const [state, setState] = useState<TelegramLinkState | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pull = useCallback(async () => {
    const row = await getTelegramLink();
    setState(row);
    return row;
  }, []);
  useEffect(() => {
    pull().catch(() => setState({ configured: false, username: "", linked: false, handle: "" }));
  }, [pull]);
  useEffect(() => {
    if (!url) return;
    const timer = window.setInterval(() => {
      getTelegramLink()
        .then((row) => {
          setState(row);
          if (row.linked) {
            setUrl(null);
            toast("Telegram привязан к этому аккаунту");
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [url]);

  async function link() {
    setBusy(true);
    try {
      const next = await startTelegramLink();
      setUrl(next.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось подготовить ссылку");
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    try {
      await stopTelegramLink();
      setUrl(null);
      setState((current) => (current ? { ...current, linked: false, handle: "" } : current));
      toast("Telegram отвязан");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось отвязать");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-3xl border border-line bg-elev p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Send className="size-4 text-muted" />
        Уведомления в Telegram
      </p>
      <p className="mt-1 text-xs text-faint">Тот же аккаунт, что и здесь. Пароль в бота писать не нужно: ссылка выдаётся, пока вы уже вошли.</p>
      {state === null ? (
        <PageLoader compact />
      ) : !state.configured ? (
        <p className="mt-3 text-sm text-muted">Администратор ещё не подключил бота.</p>
      ) : state.linked ? (
        <div className="mt-3">
          <p className="text-sm">
            Привязан{state.handle ? ` как @${state.handle}` : ""}. Сюда приходят сообщения, заявки и ответы в ленте. Файл или фото боту, до 20 МБ, сохраняются на мегадиск.
          </p>
          <button type="button" disabled={busy} className="press mt-3 h-10 rounded-xl border border-line px-3 text-sm disabled:opacity-40" onClick={() => void unlink()}>
            Отвязать
          </button>
        </div>
      ) : (
        <div className="mt-3">
          <button type="button" disabled={busy} className="press h-10 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40" onClick={() => void link()}>
            Привязать Telegram
          </button>
          {url ? (
            <div className="mt-3">
              <p className="text-xs text-faint">Откройте бота и нажмите Start. Ссылка живёт 15 минут. Пароль туда не вводите.</p>
              <input readOnly className="field mt-2 font-mono text-xs" value={url} aria-label="Ссылка на бота" onFocus={(event) => event.currentTarget.select()} />
              <div className="mt-2 flex flex-wrap gap-2">
                <a href={url} target="_blank" rel="noreferrer" className="press inline-flex h-10 items-center rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg">
                  Открыть бота
                </a>
                <button
                  type="button"
                  className="press h-10 rounded-xl border border-line px-3 text-sm"
                  onClick={() => {
                    navigator.clipboard.writeText(url).then(
                      () => toast("Ссылка скопирована"),
                      () => toast(url),
                    );
                  }}
                >
                  Копировать
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
