import { useEffect, useState } from "react";
import { Bot, CheckCircle2, ExternalLink, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { SecretInput } from "@/components/yaronetic/secret-input";
import {
  clearTelegramBot,
  getTelegramDiagnostics,
  repairTelegramBot,
  saveTelegramBot,
  type TelegramDiagnostics,
} from "@/lib/social/telegram";
export function TelegramAdmin() {
  const [state, setState] = useState<TelegramDiagnostics | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  async function run(name: string, task: () => Promise<unknown>) {
    setBusy(name);
    setError("");
    try {
      await task();
      setState(await getTelegramDiagnostics());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Проверка не удалась");
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    let active = true;
    getTelegramDiagnostics()
      .then((r) => {
        if (active) setState(r);
      })
      .catch(() => {
        if (active) setError("Не удалось загрузить настройки Telegram. Повторите проверку.");
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="mt-4 mx-auto max-w-3xl space-y-4" aria-label="Настройки Telegram-бота">
      <div className="rounded-3xl border border-line bg-elev p-5">
        <div className="flex gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent/15 text-accent">
            <Bot className="size-6" />
          </span>
          <div>
            <h3 className="text-xl font-medium">VVVion в Telegram</h3>
            <p className="mt-1 text-sm text-muted">Один аккаунт, общие модели, диалоги и баланс.</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full border border-line bg-subtle px-3 py-1">
            {state?.configured ? `@${state.username}` : "Бот не подключён"}
          </span>
          {state?.reachable && state.webhookReady ? (
            <span className="flex items-center gap-1 text-ok">
              <CheckCircle2 className="size-4" />
              На связи
            </span>
          ) : null}
        </div>
        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run("save", async () => {
              await saveTelegramBot({ data: { token } });
              setToken("");
              toast.success("Бот подключён, команды и меню настроены");
            });
          }}
        >
          <label className="block text-sm font-medium">Токен от BotFather</label>
          <SecretInput
            value={token}
            onChange={setToken}
            label="Токен Telegram-бота"
            autoComplete="off"
            placeholder={state?.configured ? "Новый токен для замены текущего" : "123456789:AA…"}
            disabled={Boolean(busy)}
            maxLength={120}
          />
          <p className="text-xs leading-relaxed text-muted">
            Создайте бота через /newbot у @BotFather и вставьте выданный токен. Новый токен
            шифруется на сервере и не возвращается в браузер. При замене на другого бота привязки
            пользователей потребуется создать заново.
          </p>
          <button
            className="press flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-accent-fg disabled:opacity-50"
            disabled={Boolean(busy) || !token.trim()}
          >
            {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : null}Сохранить и
            подключить
          </button>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noreferrer"
            className="press flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm"
          >
            Открыть BotFather
            <ExternalLink className="size-3" />
          </a>
          {state?.configured ? (
            <a
              className="press flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm"
              href={`https://t.me/${state.username}`}
              target="_blank"
              rel="noreferrer"
            >
              Открыть бота
              <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
      </div>
      {error ? (
        <div role="alert" className="rounded-2xl border border-red-500/30 p-4 text-sm text-danger">
          {error}
        </div>
      ) : null}
      <div className="rounded-3xl border border-line bg-elev p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-medium">Состояние подключения</h4>
          <button
            type="button"
            disabled={Boolean(busy)}
            className="press flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm"
            onClick={() => void run("check", async () => {})}
          >
            <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
            Проверить
          </button>
        </div>
        {!state && !error ? (
          <p role="status" className="mt-3 text-sm text-muted">
            Проверяем Telegram…
          </p>
        ) : null}
        {state ? (
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            {[
              [
                "Telegram API",
                state.reachable ? "Доступен" : state.configured ? "Нет ответа" : "Не настроен",
              ],
              ["Webhook", state.webhookReady ? "Подключён" : "Не подключён"],
              ["В очереди", state.pending],
              ["Привязок", state.links],
              ["Ошибок за сутки", state.failed],
              [
                "Последнее событие",
                state.lastUpdate
                  ? new Date(state.lastUpdate).toLocaleString("ru-RU")
                  : "Ещё не было",
              ],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 rounded-xl bg-subtle p-3">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-1 break-words font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {state?.webhookError ? (
          <p className="mt-3 text-sm text-muted">Последняя ошибка доставки: {state.webhookError}</p>
        ) : null}
        <button
          type="button"
          disabled={Boolean(busy) || !state?.configured}
          className="press mt-4 min-h-11 rounded-xl border border-line px-4 text-sm disabled:opacity-40"
          onClick={() =>
            void run("repair", async () => {
              await repairTelegramBot();
              toast.success("Меню и доставка обновлены");
            })
          }
        >
          Обновить меню и восстановить доставку
        </button>
      </div>
      <div className="rounded-3xl border border-line p-5">
        <h4 className="flex items-center gap-2 font-medium">
          <ShieldCheck className="size-4" />
          Что доступно пользователям
        </h4>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          ИИ-чат с моделями сайта и общей историей; банк и ссылки на пополнение; книги и ролики;
          загрузка файлов на Мегадиск; друзья, сообщения и уведомления. Пользователь привязывает
          Telegram в профиле сайта. Администраторам доступен /admin. Игры в бот не включены.
        </p>
        <p className="mt-2 text-xs text-muted">
          Диагностика не отправляет пробные сообщения пользователям. Для живого теста привяжите свой
          аккаунт и отправьте боту /menu.
        </p>
      </div>
      {state?.configured ? (
        <div className="rounded-2xl border border-line p-4">
          {confirm ? (
            <div>
              <p className="text-sm">
                Отключить бота и удалить привязки Telegram? Аккаунты и данные сайта сохранятся.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  className="press min-h-11 rounded-xl border border-red-500/30 px-3 text-sm"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run("clear", async () => {
                      await clearTelegramBot();
                      setConfirm(false);
                    })
                  }
                >
                  Отключить бота
                </button>
                <button className="press min-h-11 px-3 text-sm" onClick={() => setConfirm(false)}>
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="press min-h-11 text-sm text-muted"
              onClick={() => setConfirm(true)}
            >
              Отключить подключение…
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
