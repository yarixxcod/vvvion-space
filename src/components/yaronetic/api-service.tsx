import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { LoaderMark } from "@/components/yaronetic/page-loader";
import { createApiKey, getApiDesk, revokeApiKey, type ApiDesk } from "@/lib/api/desk";
import { useTx } from "@/lib/lang";

const TABS = ["curl", "python", "node", "claude", "codex", "cursor"] as const;
type Tab = (typeof TABS)[number];

function bar(used: number, cap: number | null) {
  if (cap == null || cap <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((used / cap) * 100)));
}

export function ApiService({ onBack }: { onBack: () => void }) {
  const tx = useTx();
  const navigate = useNavigate();
  const [desk, setDesk] = useState<ApiDesk | null>(null);
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState("");
  const [tab, setTab] = useState<Tab>("curl");

  function load() {
    setFailed(false);
    void getApiDesk()
      .then(setDesk)
      .catch(() => setFailed(true));
  }

  useEffect(() => { load(); }, []);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast(tx({ ru: "Скопировано", en: "Copied", kk: "Көшірілді" }));
    } catch {
      toast.error(tx({ ru: "Не удалось скопировать", en: "Could not copy", kk: "Көшіру мүмкін болмады" }));
    }
  }

  async function create() {
    if (!desk?.premium || busy) return;
    setBusy(true);
    try {
      const minted = await createApiKey({ data: { name: name || tx({ ru: "Основной", en: "Main", kk: "Негізгі" }) } });
      setSecret(minted.key);
      setName("");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tx({ ru: "Ключ не создан", en: "Key was not created", kk: "Кілт жасалмады" }));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm(tx({ ru: "Отозвать этот ключ? Его нельзя будет вернуть.", en: "Revoke this key? This cannot be undone.", kk: "Осы кілтті қайтарып алу? Қайтару мүмкін емес." }))) return;
    setBusy(true);
    try {
      await revokeApiKey({ data: { id } });
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tx({ ru: "Не отозван", en: "Not revoked", kk: "Қайтарылмады" }));
    } finally {
      setBusy(false);
    }
  }

  const chatModel = desk?.models.find((model) => model.type === "chat")?.id || "model";
  const example = exampleOf(tab, desk?.openaiBase || "https://api.vvvion.space/v1", desk?.anthropicBase || "https://api.vvvion.space", chatModel);

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto px-4 py-4">
      <button type="button" className="press inline-flex min-h-11 items-center gap-1 text-sm text-muted" onClick={onBack}>
        <ChevronLeft className="size-4" />
        {tx({ ru: "Сервисы", en: "Services", kk: "Сервистер" })}
      </button>
      <p className="mt-4 text-xs tracking-[0.22em] text-faint uppercase">VVVION</p>
      <h3 className="font-serif text-4xl tracking-tight">API</h3>
      <p className="mt-1 max-w-md text-sm text-muted">
        {tx({
          ru: "Ключи и подключение к своим инструментам. Запросы не тратят дневной лимит чата.",
          en: "Keys for your own tools. API calls do not use the chat daily limit.",
          kk: "Өз құралдарыңызға кілттер. API сұраулары чаттың күндік шегін жұмсамайды.",
        })}
      </p>

      {!desk && !failed ? <LoaderMark className="vv-loader-sm mt-6" /> : null}
      {failed && !desk ? (
        <button type="button" className="press mt-4 min-h-11 rounded-xl border border-line px-3 text-sm" onClick={load}>
          {tx({ ru: "Повторить", en: "Try again", kk: "Қайталау" })}
        </button>
      ) : null}

      {desk && !desk.enabled ? (
        <p className="mt-4 rounded-2xl border border-line bg-elev px-4 py-3 text-sm text-muted">
          {tx({
            ru: "Сервис выключен. Обычные пользователи плитку не видят, запросы получают отказ, пока админ его не включит.",
            en: "The service is off. Other people do not see the tile, and requests are refused until an admin turns it on.",
            kk: "Сервис өшірулі. Басқа адамдар плитканы көрмейді, админ қосқанша сұраулар қабылданбайды.",
          })}
        </p>
      ) : null}

      {desk && !desk.premium ? (
        <section className="mt-4 rounded-[1.4rem] border border-line bg-elev p-4">
          <KeyRound className="size-5 text-accent" aria-hidden="true" />
          <h4 className="mt-2 font-serif text-2xl">{tx({ ru: "API доступен с Premium", en: "API needs Premium", kk: "API Premium-мен ашылады" })}</h4>
          <p className="mt-1 text-sm text-muted">
            {tx({
              ru: "Ключи сохраняются. Когда подписка кончится, запросы остановятся и снова заработают после продления.",
              en: "Keys stay. When Premium ends, requests stop and resume after you renew.",
              kk: "Кілттер сақталады. Premium бітсе, сұраулар тоқтайды да, ұзартқан соң қайта істейді.",
            })}
          </p>
          <button type="button" className="press mt-4 min-h-11 rounded-2xl bg-accent px-4 text-sm font-medium text-accent-fg" onClick={() => void navigate({ to: "/", search: { place: "shop" } })}>
            {tx({ ru: "Открыть Premium", en: "Get Premium", kk: "Premium алу" })}
          </button>
        </section>
      ) : null}

      {desk ? (
        <>
          <section className="mt-4 rounded-[1.4rem] border border-line bg-elev p-4">
            <p className="text-xs text-faint">{tx({ ru: "Адреса", en: "Addresses", kk: "Мекенжайлар" })}</p>
            <CopyRow label="OpenAI" value={desk.openaiBase} onCopy={() => void copy(desk.openaiBase)} />
            <CopyRow label="Anthropic" value={desk.anthropicBase} onCopy={() => void copy(desk.anthropicBase)} />
            <p className="mt-2 text-xs text-muted">
              {tx({
                ru: "Тот же путь работает и на vvvion.space, пока домен api не подключён.",
                en: "The same path also works on vvvion.space until the api domain is connected.",
                kk: "api домені қосылғанша дәл сол жол vvvion.space-те де істейді.",
              })}
            </p>
          </section>

          <section className="mt-3 rounded-[1.4rem] border border-line bg-elev p-4">
            <p className="text-xs text-faint">{tx({ ru: "За сутки", en: "Last 24 hours", kk: "Соңғы тәулік" })}</p>
            <Meter label={tx({ ru: "Запросы", en: "Requests", kk: "Сұраулар" })} used={desk.usage.requests} cap={desk.limits.requests} />
            <Meter label={tx({ ru: "Токены", en: "Tokens", kk: "Токендер" })} used={desk.usage.tokens} cap={desk.limits.tokens} />
            <Meter label={tx({ ru: "Картинки", en: "Images", kk: "Суреттер" })} used={desk.usage.images} cap={desk.limits.images} />
            <p className="mt-2 text-xs text-muted">
              {tx({ ru: "В минуту", en: "Per minute", kk: "Минутына" })}: {desk.limits.perMinute}
            </p>
          </section>

          {secret ? (
            <section className="mt-3 rounded-[1.4rem] border border-line bg-elev p-4">
              <p className="text-sm font-medium">{tx({ ru: "Ключ показан один раз", en: "This key is shown once", kk: "Кілт бір рет көрсетіледі" })}</p>
              <p className="mt-1 text-xs text-muted">{tx({ ru: "Сохраните его сейчас. Повторно увидеть нельзя.", en: "Save it now. It cannot be shown again.", kk: "Қазір сақтаңыз. Қайта көруге болмайды." })}</p>
              <p className="mt-3 break-all font-mono text-xs">{secret}</p>
              <button type="button" className="press mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-3 text-sm text-accent-fg" onClick={() => void copy(secret)}>
                <Copy className="size-4" /> {tx({ ru: "Копировать", en: "Copy", kk: "Көшіру" })}
              </button>
            </section>
          ) : null}

          <section className="mt-3 rounded-[1.4rem] border border-line bg-elev p-4">
            <p className="text-xs text-faint">{tx({ ru: "Ключи", en: "Keys", kk: "Кілттер" })}</p>
            {desk.premium ? (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder={tx({ ru: "Имя ключа", en: "Key name", kk: "Кілт аты" })} className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-sm" />
                <button type="button" disabled={busy} className="press min-h-11 rounded-xl bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-50" onClick={() => void create()}>
                  {tx({ ru: "Создать ключ", en: "Create key", kk: "Кілт жасау" })}
                </button>
              </div>
            ) : null}
            <ul className="mt-3 space-y-2">
              {desk.keys.map((key) => (
                <li key={key.id} className="rounded-xl border border-line px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{key.name}</p>
                      <p className="mt-1 break-all font-mono text-xs text-muted">{key.prefix}…{key.last4}</p>
                    </div>
                    {!key.revoked ? (
                      <button type="button" disabled={busy} className="press min-h-11 shrink-0 rounded-xl border border-line px-3 text-xs" onClick={() => void revoke(key.id)}>
                        {tx({ ru: "Отозвать", en: "Revoke", kk: "Қайтарып алу" })}
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {key.revoked
                      ? tx({ ru: "Отозван", en: "Revoked", kk: "Қайтарылған" })
                      : !desk.premium
                        ? tx({ ru: "Приостановлен, продлите Premium", en: "Paused until Premium is renewed", kk: "Тоқтатылған, Premium-ді ұзартыңыз" })
                        : tx({ ru: "Активен", en: "Active", kk: "Белсенді" })}
                    {" · "}
                    {key.requests24h} {tx({ ru: "за 24 ч", en: "in 24 h", kk: "24 сағ" })}
                  </p>
                </li>
              ))}
              {!desk.keys.length ? <li className="text-sm text-muted">{tx({ ru: "Ключей пока нет", en: "No keys yet", kk: "Кілттер әлі жоқ" })}</li> : null}
            </ul>
          </section>

          <section className="mt-3 rounded-[1.4rem] border border-line bg-elev p-4">
            <p className="text-xs text-faint">{tx({ ru: "Модели", en: "Models", kk: "Модельдер" })}</p>
            <ul className="mt-2 space-y-1">
              {desk.models.map((model) => (
                <li key={`${model.type}:${model.id}`} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{model.displayName}</span>
                    {model.displayName !== model.id ? <span className="block truncate font-mono text-[11px] text-faint">{model.id}</span> : null}
                  </span>
                  <button type="button" className="press min-h-11 shrink-0 rounded-xl px-2 text-xs text-muted" onClick={() => void copy(model.id)}>
                    {model.type === "image" ? tx({ ru: "картинка", en: "image", kk: "сурет" }) : tx({ ru: "чат", en: "chat", kk: "чат" })}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-3 rounded-[1.4rem] border border-line bg-elev p-4">
            <p className="text-xs text-faint">{tx({ ru: "Быстрый старт", en: "Quick start", kk: "Жылдам бастау" })}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {TABS.map((id) => (
                <button key={id} type="button" className={tab === id ? "press min-h-11 rounded-xl bg-subtle px-3 text-xs" : "press min-h-11 rounded-xl px-3 text-xs text-muted"} onClick={() => setTab(id)}>
                  {id === "curl" ? "curl" : id === "python" ? "Python" : id === "node" ? "Node" : id === "claude" ? "Claude Code" : id === "codex" ? "Codex" : "Cursor"}
                </button>
              ))}
            </div>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-bg p-3 font-mono text-xs">{example}</pre>
            <button type="button" className="press mt-2 min-h-11 rounded-xl border border-line px-3 text-xs" onClick={() => void copy(example)}>
              {tx({ ru: "Копировать пример", en: "Copy example", kk: "Мысалды көшіру" })}
            </button>
          </section>

          <section className="mt-3 mb-6 rounded-[1.4rem] border border-line bg-elev p-4 text-sm">
            <p className="text-xs text-faint">{tx({ ru: "Что поддерживается", en: "What works", kk: "Не істейді" })}</p>
            <p className="mt-2 text-muted">{tx({ ru: "Чат, поток, инструменты и картинки. Не поддерживаются эмбеддинги, аудио, файлы, батчи, Assistants и сохранённые ответы Responses.", en: "Chat, streaming, tools and images. Not supported: embeddings, audio, files, batches, Assistants, and stored Responses.", kk: "Чат, ағын, құралдар және суреттер. Қолдау жоқ: эмбеддинг, аудио, файл, батч, Assistants және сақталған Responses." })}</p>
            <p className="mt-2 text-muted">{tx({ ru: "Ключ личный: не передавайте и не публикуйте его. Запросы по ключу — на владельце. При злоупотреблении ключи отзываются.", en: "The key is personal. Do not share or publish it. You are responsible for requests made with it. Abuse gets keys revoked.", kk: "Кілт жеке. Оны бермеңіз және жарияламаңыз. Кілтпен жасалған сұрауға иесі жауапты. Теріс пайдаланса, кілт қайтарылады." })}</p>
            {tab === "codex" ? <p className="mt-2 text-xs text-faint">{tx({ ru: "Пример Codex сверьте с актуальной документацией CLI.", en: "Check the Codex example against the current CLI docs.", kk: "Codex мысалын CLI құжатымен салыстырыңыз." })}</p> : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

function CopyRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted">{label}</p>
        <p className="truncate font-mono text-xs">{value}</p>
      </div>
      <button type="button" className="press inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-line" onClick={onCopy} aria-label={label}>
        <Copy className="size-4" />
      </button>
    </div>
  );
}

function Meter({ label, used, cap }: { label: string; used: number; cap: number | null }) {
  const width = bar(used, cap);
  return (
    <div className="mt-3">
      <div className="flex justify-between gap-3 text-xs">
        <span>{label}</span>
        <span className="tabular-nums text-muted">{cap == null ? String(used) : `${used} / ${cap}`}</span>
      </div>
      {width != null ? <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg"><div className="h-full bg-accent" style={{ width: `${width}%` }} /></div> : null}
    </div>
  );
}

function exampleOf(tab: Tab, openai: string, anthropic: string, model: string): string {
  if (tab === "curl") return `curl ${openai}/chat/completions \\\n  -H "Authorization: Bearer vvvion-sk-…" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"${model}","messages":[{"role":"user","content":"ping"}]}'`;
  if (tab === "python") return `from openai import OpenAI\nclient = OpenAI(base_url="${openai}", api_key="vvvion-sk-…")\nprint(client.chat.completions.create(model="${model}", messages=[{"role":"user","content":"ping"}]))`;
  if (tab === "node") return `import OpenAI from "openai";\nconst client = new OpenAI({ baseURL: "${openai}", apiKey: "vvvion-sk-…" });\nawait client.chat.completions.create({ model: "${model}", messages: [{ role: "user", content: "ping" }] });`;
  if (tab === "claude") return `ANTHROPIC_BASE_URL=${anthropic}\nANTHROPIC_AUTH_TOKEN=vvvion-sk-…\nANTHROPIC_MODEL=${model}\nANTHROPIC_SMALL_FAST_MODEL=${model}`;
  if (tab === "codex") return `[model_providers.vvvion]\nname = "VVVion"\nbase_url = "${openai}"\nenv_key = "VVVION_API_KEY"\n\n# проверьте по документации Codex`;
  return `Base URL: ${openai}\nAPI key: vvvion-sk-…\nModel: ${model}\nProtocol: OpenAI-compatible`;
}
