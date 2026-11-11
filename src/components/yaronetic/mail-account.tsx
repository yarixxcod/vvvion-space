import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { HumanCheck } from "@/components/yaronetic/human-check";
import { authClient } from "@/lib/auth/client";
import {
  confirmEmailChangeCode,
  confirmMailCode,
  getMailStatus,
  sendConfirmCode,
  sendEmailChangeCode,
  type MailStatus,
} from "@/lib/mail/codes";

async function refreshSession() {
  await authClient.getSession({ query: { disableCookieCache: true } }).catch(() => undefined);
}

export function MailAccount({
  onStatus,
  onEmail,
}: {
  onStatus: (verified: boolean) => void;
  onEmail: (email: string) => void;
}) {
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [code, setCode] = useState("");
  const [nextEmail, setNextEmail] = useState("");
  const [password, setPassword] = useState("");
  const [changeCode, setChangeCode] = useState("");
  const [sentChange, setSentChange] = useState(false);
  const [proof, setProof] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const onStatusRef = useRef(onStatus);
  const onEmailRef = useRef(onEmail);
  onStatusRef.current = onStatus;
  onEmailRef.current = onEmail;

  useEffect(() => {
    let live = true;
    void getMailStatus()
      .then((next) => {
        if (!live) return;
        setStatus(next);
        onStatusRef.current(next.verified);
        onEmailRef.current(next.email);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function sendConfirm() {
    setBusy(true);
    try {
      await sendConfirmCode();
      toast("Код отправлен на почту");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось отправить код");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      await confirmMailCode({ data: { code } });
      setStatus((current) => (current ? { ...current, verified: true } : current));
      onStatus(true);
      setCode("");
      await refreshSession();
      toast("Почта подтверждена");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Код не подошёл");
    } finally {
      setBusy(false);
    }
  }

  async function sendChange() {
    if (!proof) {
      toast.error("Подтвердите, что вы не робот.");
      return;
    }
    setBusy(true);
    try {
      await sendEmailChangeCode({ data: { email: nextEmail, password, proof } });
      setSentChange(true);
      setProof("");
      setResetKey((value) => value + 1);
      toast("Код отправлен на новую почту");
    } catch (err) {
      setProof("");
      setResetKey((value) => value + 1);
      toast.error(err instanceof Error ? err.message : "Не удалось отправить код");
    } finally {
      setBusy(false);
    }
  }

  async function confirmChange() {
    setBusy(true);
    try {
      const next = await confirmEmailChangeCode({ data: { code: changeCode } });
      setStatus(next);
      onStatus(true);
      onEmail(next.email);
      setNextEmail("");
      setPassword("");
      setChangeCode("");
      setSentChange(false);
      await refreshSession();
      toast("Почта изменена");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Код не подошёл");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 space-y-3 rounded-3xl border border-line bg-elev p-4">
      <p className="text-sm font-medium">Почта</p>
      {status === null ? <PageLoader compact /> : null}
      {status && !status.verified ? (
        <div className="rounded-2xl border border-danger/40 bg-danger/10 p-3">
          <p className="text-sm leading-relaxed">
            Почта не подтверждена. Пока адрес не подтверждён, пароль сменить нельзя, а подписку VVVION PREMIUM не купить.
          </p>
          <button type="button" disabled={busy} className="press mt-3 h-10 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40" onClick={() => void sendConfirm()}>
            Выслать код
          </button>
          <label className="mt-3 block text-xs text-faint">
            Код из письма
            <input className="field mt-1 font-mono tracking-[0.2em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} />
          </label>
          <button type="button" disabled={busy || code.trim().length < 6} className="press mt-2 h-10 w-full rounded-xl border border-line text-sm disabled:opacity-40" onClick={() => void confirm()}>
            Подтвердить почту
          </button>
        </div>
      ) : null}
      {status?.verified ? <p className="text-xs text-faint">Адрес подтверждён. Сменить его можно кодом на новую почту.</p> : null}
      <label className="block text-xs text-faint">
        Новая почта
        <input className="field mt-1" type="email" autoComplete="email" value={nextEmail} placeholder="name@mail.com" onChange={(event) => setNextEmail(event.target.value)} />
      </label>
      <label className="block text-xs text-faint">
        Текущий пароль
        <input className="field mt-1" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      <HumanCheck resetKey={resetKey} onPayload={setProof} />
      <button type="button" disabled={busy} className="press h-10 w-full rounded-xl border border-line text-sm disabled:opacity-40" onClick={() => void sendChange()}>
        Выслать код на новую почту
      </button>
      {sentChange ? (
        <>
          <label className="block text-xs text-faint">
            Код с новой почты
            <input className="field mt-1 font-mono tracking-[0.2em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={changeCode} onChange={(event) => setChangeCode(event.target.value)} />
          </label>
          <button type="button" disabled={busy || changeCode.trim().length < 6} className="press h-10 w-full rounded-xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40" onClick={() => void confirmChange()}>
            Сменить почту
          </button>
        </>
      ) : null}
    </section>
  );
}
