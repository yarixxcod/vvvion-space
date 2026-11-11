import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth/client";
import { ui } from "@/lib/i18n";
import { txNow, useLang } from "@/lib/lang";
import { SecretInput } from "@/components/yaronetic/secret-input";
import { HumanCheck } from "@/components/yaronetic/human-check";
import { confirmPasswordCode, requestPasswordCode, sendConfirmCode } from "@/lib/mail/codes";

const BEARER_KEY = "grok-auth.bearer-token";

function explain(error: { message?: string; code?: string } | null | undefined) {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (code === "USER_ALREADY_EXISTS" || /already exists/i.test(message)) {
    return txNow({ ru: "Такой логин уже есть. Войдите.", en: "That login already exists. Sign in.", kk: "Мұндай логин бар. Кіріңіз." });
  }
  if (code === "INVALID_EMAIL_OR_PASSWORD" || /invalid email or password/i.test(message)) {
    return txNow({ ru: "Неверный логин или пароль.", en: "Wrong login or password.", kk: "Логин немесе құпия сөз қате." });
  }
  if (/password/i.test(message) && /(short|least|8)/i.test(message)) {
    return txNow({ ru: "Пароль не короче 8 символов.", en: "The password must be at least 8 characters.", kk: "Құпия сөз 8 таңбадан кем болмасын." });
  }
  if (/invalid email/i.test(message)) return txNow({ ru: "Логин — это адрес почты.", en: "The login is an email address.", kk: "Логин — пошта мекенжайы." });
  if (/invalid origin/i.test(message)) return txNow({ ru: "Не удалось войти с этой страницы.", en: "Could not sign in from this page.", kk: "Бұл беттен кіру болмады." });
  if (/too many|слишком много попыток|временно закрыт/i.test(message)) {
    return message.includes("Слишком") || message.includes("закрыт")
      ? message
      : txNow({ ru: "Слишком много попыток. Подождите и попробуйте снова.", en: "Too many attempts. Wait and try again.", kk: "Тым көп әрекет. Күтіп, қайта көріңіз." });
  }
  if (/робот|not a robot|captcha/i.test(message)) {
    return txNow({ ru: "Подтвердите, что вы не робот.", en: "Confirm that you are not a robot.", kk: "Робот емес екеніңізді растаңыз." });
  }
  return message || txNow({ ru: "Не удалось войти", en: "Could not sign in", kk: "Кіру болмады" });
}

async function keepSession(response: Response) {
  const token = response.headers.get("set-auth-token");
  if (token) {
    try {
      sessionStorage.setItem(BEARER_KEY, token);
    } catch {
      /* preview storage can be blocked */
    }
  }
  await authClient.getSession();
}

export function AuthForm({ locked = false }: { locked?: boolean }) {
  const [mode, setMode] = useState<"up" | "in" | "reset">("up");
  const [step, setStep] = useState<"ask" | "code">("ask");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [proof, setProof] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const lang = useLang();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const login = email.trim().toLowerCase();
    if (!login.includes("@")) {
      toast.error(txNow({ ru: "Логин — это адрес почты.", en: "The login is an email address.", kk: "Логин — пошта мекенжайы." }));
      return;
    }
    if (password.length < 8) {
      toast.error(txNow({ ru: "Пароль не короче 8 символов.", en: "The password must be at least 8 characters.", kk: "Құпия сөз 8 таңбадан кем болмасын." }));
      return;
    }
    if (!proof) {
      toast.error(txNow({ ru: "Подтвердите, что вы не робот.", en: "Confirm that you are not a robot.", kk: "Робот емес екеніңізді растаңыз." }));
      return;
    }
    setBusy(true);
    try {
      if (mode === "up") {
        const display = name.trim();
        if (display.length < 1 || display.length > 40) {
          toast.error(txNow({ ru: "Имя — от 1 до 40 символов.", en: "The name must be 1 to 40 characters.", kk: "Есім 1-ден 40 таңбаға дейін." }));
          setBusy(false);
          return;
        }
        let kept: Promise<void> = Promise.resolve();
        const { error } = await authClient.signUp.email({
          email: login,
          password,
          name: display,
          fetchOptions: {
            headers: { "x-captcha": proof },
            onSuccess: (ctx) => {
              kept = keepSession(ctx.response);
            },
          },
        });
        if (error) throw new Error(explain(error));
        await kept;
        await sendConfirmCode().catch((err: unknown) => {
          toast.error(err instanceof Error ? err.message : txNow({ ru: "Аккаунт создан, но код на почту не ушёл. Отправьте его из профиля.", en: "The account was created, but the email code did not go out. Send it from the profile.", kk: "Аккаунт ашылды, бірақ поштаға код кетпеді. Оны профильден жіберіңіз." }));
        });
      } else {
        const { error } = await authClient.signIn.email({
          email: login,
          password,
          fetchOptions: {
            headers: { "x-captcha": proof },
            onSuccess: (ctx) => void keepSession(ctx.response),
          },
        });
        if (error) throw new Error(explain(error));
      }
      await authClient.getSession();
    } catch (err) {
      setProof("");
      setResetKey((value) => value + 1);
      toast.error(err instanceof Error ? err.message : txNow({ ru: "Не удалось войти", en: "Could not sign in", kk: "Кіру болмады" }));
    } finally {
      setBusy(false);
    }
  }

  async function sendReset(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const login = email.trim().toLowerCase();
    if (!login.includes("@")) {
      toast.error(txNow({ ru: "Напишите почту, с которой входили.", en: "Enter the email you used to sign in.", kk: "Кірген поштаны жазыңыз." }));
      return;
    }
    if (!proof) {
      toast.error(txNow({ ru: "Подтвердите, что вы не робот.", en: "Confirm that you are not a robot.", kk: "Робот емес екеніңізді растаңыз." }));
      return;
    }
    setBusy(true);
    try {
      await requestPasswordCode({ data: { email: login, proof } });
      setProof("");
      setResetKey((value) => value + 1);
      setStep("code");
      toast(txNow({ ru: "Если адрес есть в аккаунте, код уже в письме.", en: "If the address belongs to an account, the code is already in the email.", kk: "Мекенжай аккаунтта болса, код хатта." }));
    } catch (err) {
      setProof("");
      setResetKey((value) => value + 1);
      toast.error(err instanceof Error ? err.message : txNow({ ru: "Не удалось отправить код", en: "Could not send the code", kk: "Код жіберілмеді" }));
    } finally {
      setBusy(false);
    }
  }

  async function saveReset(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password.length < 8) {
      toast.error(txNow({ ru: "Пароль не короче 8 символов.", en: "The password must be at least 8 characters.", kk: "Құпия сөз 8 таңбадан кем болмасын." }));
      return;
    }
    if (!proof) {
      toast.error(txNow({ ru: "Подтвердите, что вы не робот.", en: "Confirm that you are not a robot.", kk: "Робот емес екеніңізді растаңыз." }));
      return;
    }
    setBusy(true);
    try {
      await confirmPasswordCode({ data: { email: email.trim().toLowerCase(), code, password, proof } });
      setPassword("");
      setCode("");
      setStep("ask");
      setMode("in");
      setProof("");
      setResetKey((value) => value + 1);
      toast(txNow({ ru: "Пароль обновлён. Войдите с новым.", en: "Password updated. Sign in with the new one.", kk: "Құпия сөз жаңарды. Жаңасымен кіріңіз." }));
    } catch (err) {
      setProof("");
      setResetKey((value) => value + 1);
      toast.error(err instanceof Error ? err.message : txNow({ ru: "Не удалось сменить пароль", en: "Could not change the password", kk: "Құпия сөзді ауыстыру болмады" }));
    } finally {
      setBusy(false);
    }
  }

  if (mode === "reset") {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="font-serif text-3xl tracking-tight">{txNow({ ru: "Восстановление", en: "Recovery", kk: "Қалпына келтіру" })}</h2>
          <p className="mt-2 text-sm text-muted">
            {step === "ask"
              ? ui(lang, "resetAsk")
              : txNow({ ru: "Введите код из письма и новый пароль. Код действует 15 минут.", en: "Enter the code from the email and a new password. The code lasts 15 minutes.", kk: "Хаттағы код пен жаңа құпия сөзді жазыңыз. Код 15 минут жарамды." })}
          </p>
        </div>
        {step === "ask" ? (
          <form className="flex flex-col gap-2" onSubmit={(event) => void sendReset(event)}>
            <label className="flex flex-col gap-1 text-xs text-faint">
              {ui(lang, "login")}
              <input className="field" type="email" value={email} autoComplete="username" placeholder="name@mail.com" onChange={(event) => setEmail(event.target.value)} />
            </label>
            <HumanCheck resetKey={resetKey} onPayload={setProof} />
            <button type="submit" disabled={busy} className="press mt-1 h-11 rounded-2xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40">
              {busy ? ui(lang, "wait") : ui(lang, "sendCode")}
            </button>
          </form>
        ) : (
          <form className="flex flex-col gap-2" onSubmit={(event) => void saveReset(event)}>
            <label className="flex flex-col gap-1 text-xs text-faint">
              {ui(lang, "codeFromMail")}
              <input className="field font-mono tracking-[0.2em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-faint">
              {ui(lang, "newPassword")}
              <SecretInput value={password} autoComplete="new-password" maxLength={128} label={ui(lang, "newPassword")} onChange={setPassword} />
            </label>
            <HumanCheck resetKey={resetKey + 1} onPayload={setProof} />
            <button type="submit" disabled={busy} className="press mt-1 h-11 rounded-2xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40">
              {busy ? ui(lang, "wait") : ui(lang, "savePassword")}
            </button>
            <button type="button" className="press h-10 text-sm text-muted" onClick={() => void sendReset({ preventDefault() {} } as FormEvent)}>
              {ui(lang, "resendCode")}
            </button>
          </form>
        )}
        <button
          type="button"
          className="press h-10 text-sm text-muted"
          onClick={() => {
            setMode("in");
            setStep("ask");
          }}
        >
          {ui(lang, "backToSignIn")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-3xl tracking-tight">
          {locked ? ui(lang, "needAccount") : mode === "up" ? ui(lang, "signUp") : ui(lang, "signIn")}
        </h2>
        <p className="mt-2 text-sm text-muted">
          {locked ? ui(lang, "lockedLead") : ui(lang, "authLead")}
        </p>
      </div>
      <form className="flex flex-col gap-2" onSubmit={(event) => void submit(event)}>
        {mode === "up" ? (
          <label className="flex flex-col gap-1 text-xs text-faint">
            {ui(lang, "nameInCircle")}
            <input
              className="field"
              value={name}
              autoComplete="name"
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-xs text-faint">
          {ui(lang, "login")}
          <input
            className="field"
            type="email"
            value={email}
            autoComplete="username"
            placeholder="name@mail.com"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">
          {ui(lang, "password")}
          <SecretInput
            value={password}
            autoComplete={mode === "up" ? "new-password" : "current-password"}
            maxLength={128}
            label={ui(lang, "password")}
            onChange={setPassword}
          />
        </label>
        <HumanCheck resetKey={resetKey} onPayload={setProof} />
        <button
          type="submit"
          disabled={busy}
          className="press mt-1 h-11 rounded-2xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40"
        >
          {busy ? ui(lang, "wait") : mode === "up" ? ui(lang, "createAccount") : ui(lang, "enter")}
        </button>
      </form>
      <button
        type="button"
        className="press h-10 text-sm text-muted"
        onClick={() => setMode((value) => (value === "up" ? "in" : "up"))}
      >
        {mode === "up" ? ui(lang, "haveAccount") : ui(lang, "noAccount")}
      </button>
      {mode === "in" ? (
        <button
          type="button"
          className="press -mt-2 h-10 text-sm text-muted"
          onClick={() => {
            setStep("ask");
            setMode("reset");
          }}
        >
          {ui(lang, "forgot")}
        </button>
      ) : null}
    </div>
  );
}
