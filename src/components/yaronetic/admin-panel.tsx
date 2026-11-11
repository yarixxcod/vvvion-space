import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { SecretInput } from "@/components/yaronetic/secret-input";
import { MegaAdmin } from "@/components/yaronetic/mega-admin";
import { PersonFace, refreshFaceMarks } from "@/components/yaronetic/person-face";
import { VpnDeskCard } from "@/components/yaronetic/vpn-admin";
import { WhisperCard } from "@/components/yaronetic/whisper-card";
import { AppReleaseCard } from "@/components/yaronetic/app-release-admin";
import { PriceAdmin } from "@/components/yaronetic/price-admin";
import { getUsagePolicy, saveUsagePolicy, type UsagePolicy } from "@/lib/social/limits";
import {
  clearAttempts,
  chatStats,
  listAdminImageModels,
  listAdminModels,
  listAdminTtsModels,
  listAttempts,
  listMembers,
  removeImageModel,
  removeModel,
  removeTtsModel,
  saveImageModel,
  saveModel,
  saveTtsModel,
  setBan,
  setMemberPremium,
  setRole,
  type AdminImageModel,
  type AdminModel,
  type AdminProvider,
  type AdminTtsModel,
  type AttemptRow,
  type ChatStats,
  type MemberRow,
} from "@/lib/social/admin";

const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;
const TABS = [
  ["people", "Участники"],
  ["models", "Модели"],
  ["images", "Картинки"],
  ["voice", "Голос"],
  ["journal", "Журнал"],
  ["stats", "Статистика"],
  ["servers", "Серверы"],
  ["release", "Обновление"],
  ["prices", "Цены"],
] as const;

type TabId = (typeof TABS)[number][0];

type DraftProvider = AdminProvider;

type ModelDraft = {
  name: string;
  previousName: string;
  displayName: string;
  icon: string;
  prompt: string;
  providers: DraftProvider[];
};

type ImageDraft = {
  name: string;
  previousName: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  clearKey: boolean;
  hasKey: boolean;
};

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function blankProvider(): DraftProvider {
  return { baseUrl: "https://api.x.ai/v1", apiKey: "", model: "" };
}

function slugKey(value: string) {
  const ascii = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._:/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-./]+|[-./]+$/g, "")
    .slice(0, 80);
  return ascii && MODEL_RE.test(ascii) ? ascii : "";
}

function catalogKey(draft: ModelDraft) {
  if (draft.previousName) return draft.name;
  return slugKey(draft.displayName) || slugKey(draft.providers[0]?.model || "");
}

function fromModel(model: AdminModel): ModelDraft {
  const providers = (model.providers.length ? model.providers : [blankProvider()]).slice(0, 4).map((item) => ({
    baseUrl: item.baseUrl,
    apiKey: item.apiKey,
    model: item.model || model.name,
  }));
  return {
    name: model.name,
    previousName: model.name,
    displayName: model.displayName,
    icon: model.icon,
    prompt: model.prompt,
    providers,
  };
}

function blankModel(): ModelDraft {
  return { name: "", previousName: "", displayName: "", icon: "", prompt: "", providers: [blankProvider()] };
}

function fromImage(model: AdminImageModel): ImageDraft {
  return {
    name: model.name,
    previousName: model.name,
    displayName: model.displayName,
    baseUrl: model.baseUrl,
    apiKey: "",
    clearKey: false,
    hasKey: model.hasKey,
  };
}

function blankImage(): ImageDraft {
  return {
    name: "",
    previousName: "",
    displayName: "",
    baseUrl: "https://api.x.ai/v1",
    apiKey: "",
    clearKey: false,
    hasKey: false,
  };
}

type TtsDraft = ImageDraft & { voice: string };

function fromTts(model: AdminTtsModel): TtsDraft {
  return { ...fromImage(model), voice: model.voice || "alloy" };
}

function blankTts(): TtsDraft {
  return { ...blankImage(), baseUrl: "https://api.openai.com/v1", voice: "alloy" };
}

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

async function readIcon(file: File) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Иконка: png, jpeg или webp");
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bmp.close?.();
    throw new Error("Иконка не прочиталась");
  }
  ctx.drawImage(bmp, 0, 0, 96, 96);
  bmp.close?.();
  const blob =
    (await new Promise<Blob | null>((resolve) => canvas.toBlob((next) => resolve(next), "image/webp", 0.82))) ||
    (await new Promise<Blob | null>((resolve) => canvas.toBlob((next) => resolve(next), "image/jpeg", 0.82)));
  if (!blob) throw new Error("Иконка не прочиталась");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Иконка не прочиталась"));
    reader.readAsDataURL(blob);
  });
  if (data.length > 80_000 || !/^data:image\/(png|jpeg|webp);base64,/.test(data)) throw new Error("Иконка слишком большая");
  return data;
}

export function AdminPanel() {
  const [tab, setTab] = useState<TabId>("people");
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [models, setModels] = useState<AdminModel[] | null>(null);
  const [images, setImages] = useState<AdminImageModel[] | null>(null);
  const [voices, setVoices] = useState<AdminTtsModel[] | null>(null);
  const [policy, setPolicy] = useState<UsagePolicy | null>(null);

  useEffect(() => {
    if (tab !== "people" || members) return;
    void listMembers()
      .then(setMembers)
      .catch((error: unknown) => toast.error(messageOf(error, "Участники не открылись")));
  }, [tab, members]);

  useEffect(() => {
    if (tab !== "models" || models) return;
    void listAdminModels()
      .then(setModels)
      .catch((error: unknown) => toast.error(messageOf(error, "Модели не открылись")));
    void getUsagePolicy()
      .then(setPolicy)
      .catch((error: unknown) => toast.error(messageOf(error, "Лимиты не открылись")));
  }, [tab, models]);

  useEffect(() => {
    if (tab !== "images" || images) return;
    void listAdminImageModels()
      .then(setImages)
      .catch((error: unknown) => toast.error(messageOf(error, "Картинки не открылись")));
  }, [tab, images]);

  useEffect(() => {
    if (tab !== "voice" || voices) return;
    void listAdminTtsModels()
      .then(setVoices)
      .catch((error: unknown) => toast.error(messageOf(error, "Голос не открылся")));
  }, [tab, voices]);

  return (
    <div className="h-full overflow-y-auto px-3 py-4 sm:px-4">
      <h3 className="font-serif text-2xl tracking-tight">Админ</h3>
      <p className="mt-1 text-sm text-muted">Модели, лимиты и участники. В чате видно название, запрос уходит с именем модели провайдера.</p>
      <div className="mt-3 flex gap-1 overflow-x-auto">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "press h-9 shrink-0 rounded-xl bg-subtle px-3 text-sm" : "press h-9 shrink-0 rounded-xl px-3 text-sm text-muted"}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "people" ? <People members={members} onChange={setMembers} /> : null}
      {tab === "models" ? <Models models={models} policy={policy} onModels={setModels} onPolicy={setPolicy} /> : null}
      {tab === "images" ? <Images models={images} onChange={setImages} /> : null}
      {tab === "voice" ? <Voices models={voices} onChange={setVoices} /> : null}
      {tab === "journal" ? <Journal /> : null}
      {tab === "stats" ? <Stats /> : null}
      {tab === "release" ? <AppReleaseCard /> : null}
      {tab === "prices" ? <PriceAdmin /> : null}
      {tab === "servers" ? (
        <div className="mt-4">
          <WhisperCard />
          <VpnDeskCard />
          <div className="mt-6">
            <MegaAdmin />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function People({ members, onChange }: { members: MemberRow[] | null; onChange: (rows: MemberRow[]) => void }) {
  const [busy, setBusy] = useState(false);

  async function run(task: () => Promise<MemberRow[]>, ok: string) {
    if (busy) return;
    setBusy(true);
    try {
      onChange(await task());
      refreshFaceMarks();
      toast(ok);
    } catch (error) {
      toast.error(messageOf(error, "Не получилось"));
    } finally {
      setBusy(false);
    }
  }

  if (!members) return <PageLoader />;
  return (
    <ul className="mt-4 space-y-2">
      {members.map((member) => (
        <li key={member.id} className="rounded-2xl border border-line bg-elev px-3 py-3">
          <div className="flex items-center gap-3">
            <PersonFace name={member.name} image={member.image} userId={member.id} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {member.name}
                {member.role === "admin" ? <span className="ml-2 text-xs text-faint">админ</span> : null}
                {member.banned ? <span className="ml-2 text-xs text-danger">блок</span> : null}
                {member.premiumUntil ? <span className="ml-2 text-xs text-faint">premium</span> : null}
              </p>
              <p className="truncate text-xs text-faint">{member.email}</p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={busy}
              className="press h-9 rounded-lg border border-line px-2 text-xs disabled:opacity-40"
              onClick={() => void run(() => setRole({ data: { id: member.id, role: member.role === "admin" ? "member" : "admin" } }), member.role === "admin" ? "Роль снята" : "Теперь админ")}
            >
              {member.role === "admin" ? "Снять админа" : "Сделать админом"}
            </button>
            <button
              type="button"
              disabled={busy || member.role === "admin"}
              className="press h-9 rounded-lg border border-line px-2 text-xs disabled:opacity-40"
              onClick={() => void run(() => setBan({ data: { id: member.id, banned: !member.banned } }), member.banned ? "Доступ открыт" : "Доступ закрыт")}
            >
              {member.banned ? "Разблокировать" : "Заблокировать"}
            </button>
            <button
              type="button"
              disabled={busy}
              className="press h-9 rounded-lg border border-line px-2 text-xs disabled:opacity-40"
              onClick={() => void run(() => setMemberPremium({ data: { id: member.id, grant: !member.premiumUntil } }), member.premiumUntil ? "Premium снят" : "Premium выдан")}
            >
              {member.premiumUntil ? "Снять Premium" : "Дать Premium"}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Models({
  models,
  policy,
  onModels,
  onPolicy,
}: {
  models: AdminModel[] | null;
  policy: UsagePolicy | null;
  onModels: (rows: AdminModel[]) => void;
  onPolicy: (row: UsagePolicy) => void;
}) {
  const [fresh, setFresh] = useState<ModelDraft>(blankModel);
  if (!models) return <PageLoader />;
  return (
    <div className="mt-4 space-y-3">
      <Limits policy={policy} onChange={onPolicy} />
      {models.map((model) => (
        <ModelCard key={model.name} model={model} onSaved={onModels} onRemoved={onModels} />
      ))}
      <ModelForm
        title="Новая модель"
        draft={fresh}
        onChange={(patch) => setFresh((current) => ({ ...current, ...patch, providers: patch.providers ?? current.providers }))}
        onSaved={(rows) => {
          onModels(rows);
          setFresh(blankModel());
        }}
      />
    </div>
  );
}

function Limits({ policy, onChange }: { policy: UsagePolicy | null; onChange: (row: UsagePolicy) => void }) {
  const [requests, setRequests] = useState("");
  const [tokens, setTokens] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!policy) return;
    setRequests(policy.dailyRequests == null ? "" : String(policy.dailyRequests));
    setTokens(policy.dailyTokens == null ? "" : String(policy.dailyTokens));
  }, [policy]);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const next = await saveUsagePolicy({
        data: {
          dailyRequests: requests.trim() === "" ? null : Number(requests),
          dailyTokens: tokens.trim() === "" ? null : Number(tokens),
        },
      });
      onChange(next);
      toast("Лимиты сохранены");
    } catch (error) {
      toast.error(messageOf(error, "Лимиты не сохранились"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-elev p-3">
      <h4 className="text-sm font-medium">Дневные лимиты</h4>
      <p className="mt-1 text-[13px] text-muted">Пустое поле — без потолка. С Premium лимит вдвое выше. Купленные запросы добавляются сверху.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-faint">
          Запросов в сутки
          <input className="field mt-1 tabular-nums" inputMode="numeric" value={requests} placeholder="без лимита" onChange={(event) => setRequests(event.target.value.replace(/[^\d]/g, "").slice(0, 8))} />
        </label>
        <label className="block text-xs text-faint">
          Токенов в сутки
          <input className="field mt-1 tabular-nums" inputMode="numeric" value={tokens} placeholder="без лимита" onChange={(event) => setTokens(event.target.value.replace(/[^\d]/g, "").slice(0, 8))} />
        </label>
      </div>
      <button type="button" disabled={busy || !policy} className="press mt-3 h-10 rounded-xl border border-line px-3 text-sm disabled:opacity-40" onClick={() => void save()}>
        Сохранить лимиты
      </button>
    </section>
  );
}

function ModelCard({ model, onSaved, onRemoved }: { model: AdminModel; onSaved: (rows: AdminModel[]) => void; onRemoved: (rows: AdminModel[]) => void }) {
  const [draft, setDraft] = useState(() => fromModel(model));
  useEffect(() => setDraft(fromModel(model)), [model]);
  return (
    <ModelForm
      title={model.displayName || model.name}
      draft={draft}
      onChange={(patch) => setDraft((current) => ({ ...current, ...patch, providers: patch.providers ?? current.providers }))}
      onSaved={onSaved}
      onRemove={async () => {
        if (!window.confirm(`Удалить «${model.displayName || model.name}»?`)) return;
        onRemoved(await removeModel({ data: model.name }));
        toast("Модель удалена");
      }}
    />
  );
}

function ModelForm({
  title,
  draft,
  onChange,
  onSaved,
  onRemove,
}: {
  title: string;
  draft: ModelDraft;
  onChange: (patch: Partial<ModelDraft>) => void;
  onSaved: (rows: AdminModel[]) => void;
  onRemove?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  function patchProvider(index: number, patch: Partial<DraftProvider>) {
    onChange({
      providers: draft.providers.map((item, at) => (at === index ? { ...item, ...patch } : item)),
    });
  }

  async function save() {
    if (busy) return;
    const displayName = draft.displayName.trim();
    if (!displayName) {
      toast.error("Нужно название в списке");
      return;
    }
    for (const provider of draft.providers) {
      const model = provider.model.trim();
      if (!model || model.length > 120 || !MODEL_RE.test(model)) {
        toast.error("У каждого провайдера своё имя модели: латиница, цифры и . _ : / -");
        return;
      }
    }
    const name = catalogKey({ ...draft, displayName });
    if (!name) {
      toast.error("Не из чего собрать внутренний ключ. Название или имя модели должно быть латиницей.");
      return;
    }
    setBusy(true);
    try {
      const rows = await saveModel({
        data: {
          name,
          previousName: draft.previousName,
          displayName,
          icon: draft.icon,
          prompt: draft.prompt.trim(),
          providers: draft.providers.map((item) => ({
            baseUrl: item.baseUrl.trim(),
            apiKey: item.apiKey.trim(),
            model: item.model.trim(),
          })),
        },
      });
      onSaved(rows);
      toast("Модель сохранена");
    } catch (error) {
      toast.error(messageOf(error, "Модель не сохранилась"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-elev p-3">
      <h4 className="text-sm font-medium">{title}</h4>
      <p className="mt-1 text-[13px] text-muted">В списке чата видно название. У каждого провайдера свой адрес, ключ и имя модели — запрос уходит именно с ним. Если первый молчит, пробуем следующий. Пустой ключ берёт ключ сервера.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[auto_1fr] sm:items-end">
        <label className="block text-xs text-faint">
          Иконка
          <span className="mt-1 flex items-center gap-2">
            {draft.icon ? <img src={draft.icon} alt="" className="size-11 rounded-xl object-cover" /> : <span className="grid size-11 place-items-center rounded-xl border border-line text-xs text-faint">нет</span>}
            <label className="press inline-flex h-11 items-center gap-2 rounded-2xl border border-line bg-elev px-3 text-sm">
              Выбрать иконку
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  void readIcon(file)
                    .then((icon) => onChange({ icon }))
                    .catch((error: unknown) => toast.error(messageOf(error, "Иконка не подошла")));
                }}
              />
            </label>
          </span>
        </label>
        <label className="block text-xs text-faint">
          Название в списке
          <input
            className="field mt-1"
            value={draft.displayName}
            maxLength={48}
            placeholder="Deepseek 4.1"
            onChange={(event) => onChange({ displayName: event.target.value })}
          />
        </label>
      </div>
      <label className="mt-2 block text-xs text-faint">
        Системный промпт
        <textarea className="field mt-1 min-h-20 resize-y" value={draft.prompt} maxLength={4000} onChange={(event) => onChange({ prompt: event.target.value })} />
      </label>
      <div className="mt-3 space-y-2">
        {draft.providers.map((provider, index) => (
          <div key={index} className="rounded-2xl border border-line bg-bg p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-faint">Провайдер {index + 1}</p>
              {draft.providers.length > 1 ? (
                <button
                  type="button"
                  className="press h-8 rounded-lg px-2 text-xs text-danger"
                  onClick={() => onChange({ providers: draft.providers.filter((_, at) => at !== index) })}
                >
                  Убрать
                </button>
              ) : null}
            </div>
            <label className="mt-2 block text-xs text-faint">
              Эндпойнт
              <input className="field mt-1 font-mono text-sm" value={provider.baseUrl} maxLength={300} placeholder="https://api.example.com/v1" onChange={(event) => patchProvider(index, { baseUrl: event.target.value })} />
            </label>
            <label className="mt-2 block text-xs text-faint">
              Ключ
              <SecretInput className="mt-1 font-mono text-sm" value={provider.apiKey} maxLength={400} autoComplete="off" label={`Ключ провайдера ${index + 1}`} placeholder="Пусто — ключ сервера" onChange={(apiKey) => patchProvider(index, { apiKey })} />
            </label>
            <label className="mt-2 block text-xs text-faint">
              Имя модели на этом сервере
              <input className="field mt-1 font-mono text-sm" value={provider.model} maxLength={120} placeholder="deepseek-chat или deepseek/deepseek-4.1" onChange={(event) => patchProvider(index, { model: event.target.value })} />
            </label>
          </div>
        ))}
      </div>
      {draft.providers.length < 4 ? (
        <button type="button" className="press mt-2 h-9 rounded-xl px-2 text-xs text-muted" onClick={() => onChange({ providers: [...draft.providers, blankProvider()] })}>
          Ещё провайдер
        </button>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy} className="press h-10 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40" onClick={() => void save()}>
          Сохранить
        </button>
        {onRemove ? (
          <button
            type="button"
            disabled={busy}
            className="press h-10 rounded-xl border border-line px-3 text-sm text-danger disabled:opacity-40"
            onClick={() => {
              setBusy(true);
              void onRemove()
                .catch((error: unknown) => toast.error(messageOf(error, "Не удалось удалить")))
                .finally(() => setBusy(false));
            }}
          >
            Удалить
          </button>
        ) : null}
        {draft.icon ? (
          <button type="button" className="press h-10 rounded-xl px-3 text-sm text-muted" onClick={() => onChange({ icon: "" })}>
            Убрать иконку
          </button>
        ) : null}
      </div>
    </section>
  );
}

function Images({ models, onChange }: { models: AdminImageModel[] | null; onChange: (rows: AdminImageModel[]) => void }) {
  const [fresh, setFresh] = useState<ImageDraft>(blankImage);
  if (!models) return <PageLoader />;
  return (
    <div className="mt-4 space-y-3">
      {models.map((model) => (
        <ImageCard key={model.name} model={model} onChange={onChange} />
      ))}
      <ImageForm
        title="Новая модель картинок"
        draft={fresh}
        onChange={(patch) => setFresh((current) => ({ ...current, ...patch }))}
        onSaved={(rows) => {
          onChange(rows);
          setFresh(blankImage());
        }}
      />
    </div>
  );
}

function ImageCard({ model, onChange }: { model: AdminImageModel; onChange: (rows: AdminImageModel[]) => void }) {
  const [draft, setDraft] = useState(() => fromImage(model));
  useEffect(() => setDraft(fromImage(model)), [model]);
  return (
    <ImageForm
      title={model.displayName || model.name}
      draft={draft}
      onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
      onSaved={onChange}
      onRemove={async () => {
        if (!window.confirm(`Удалить «${model.displayName || model.name}»?`)) return;
        onChange(await removeImageModel({ data: model.name }));
        toast("Модель удалена");
      }}
    />
  );
}

function ImageForm({
  title,
  draft,
  onChange,
  onSaved,
  onRemove,
}: {
  title: string;
  draft: ImageDraft;
  onChange: (patch: Partial<ImageDraft>) => void;
  onSaved: (rows: AdminImageModel[]) => void;
  onRemove?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    const name = draft.name.trim();
    if (!name || name.length > 80 || !MODEL_RE.test(name)) {
      toast.error("Имя модели картинок: латиница, цифры и . _ : / -");
      return;
    }
    setBusy(true);
    try {
      const rows = await saveImageModel({
        data: {
          name,
          previousName: draft.previousName,
          displayName: draft.displayName.trim() || name,
          baseUrl: draft.baseUrl.trim(),
          apiKey: draft.apiKey.trim(),
          clearKey: draft.clearKey,
        },
      });
      onSaved(rows);
      toast("Модель сохранена");
    } catch (error) {
      toast.error(messageOf(error, "Модель не сохранилась"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-elev p-3">
      <h4 className="text-sm font-medium">{title}</h4>
      <label className="mt-3 block text-xs text-faint">
        Название в списке
        <input className="field mt-1" value={draft.displayName} maxLength={48} placeholder="Flux" onChange={(event) => onChange({ displayName: event.target.value })} />
      </label>
      <label className="mt-2 block text-xs text-faint">
        Модель
        <input className="field mt-1 font-mono text-sm" value={draft.name} maxLength={80} placeholder="grok-2-image" onChange={(event) => onChange({ name: event.target.value })} />
      </label>
      <label className="mt-2 block text-xs text-faint">
        Эндпойнт
        <input className="field mt-1 font-mono text-sm" value={draft.baseUrl} maxLength={300} onChange={(event) => onChange({ baseUrl: event.target.value })} />
      </label>
      <label className="mt-2 block text-xs text-faint">
        Ключ
        <SecretInput className="mt-1 font-mono text-sm" value={draft.apiKey} maxLength={400} autoComplete="off" label="Ключ модели картинок" placeholder={draft.hasKey && !draft.clearKey ? "Сохранён, введите новый чтобы заменить" : "Ключ"} onChange={(apiKey) => onChange({ apiKey, clearKey: false })} />
      </label>
      {draft.hasKey ? (
        <label className="mt-2 flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={draft.clearKey} onChange={(event) => onChange({ clearKey: event.target.checked, apiKey: event.target.checked ? "" : draft.apiKey })} />
          Убрать сохранённый ключ
        </label>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy} className="press h-10 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40" onClick={() => void save()}>
          Сохранить
        </button>
        {onRemove ? (
          <button
            type="button"
            disabled={busy}
            className="press h-10 rounded-xl border border-line px-3 text-sm text-danger disabled:opacity-40"
            onClick={() => {
              setBusy(true);
              void onRemove()
                .catch((error: unknown) => toast.error(messageOf(error, "Не удалось удалить")))
                .finally(() => setBusy(false));
            }}
          >
            Удалить
          </button>
        ) : null}
      </div>
    </section>
  );
}

function Voices({ models, onChange }: { models: AdminTtsModel[] | null; onChange: (rows: AdminTtsModel[]) => void }) {
  const [fresh, setFresh] = useState<TtsDraft>(blankTts);
  if (!models) return <PageLoader />;
  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-muted">Озвучка ответов. Берётся первая модель с ключом. Запрос идёт на /audio/speech, как у OpenAI.</p>
      {models.map((model) => (
        <TtsCard key={model.name} model={model} onChange={onChange} />
      ))}
      <TtsForm
        title="Новая модель голоса"
        draft={fresh}
        onChange={(patch) => setFresh((current) => ({ ...current, ...patch }))}
        onSaved={(rows) => {
          onChange(rows);
          setFresh(blankTts());
        }}
      />
    </div>
  );
}

function TtsCard({ model, onChange }: { model: AdminTtsModel; onChange: (rows: AdminTtsModel[]) => void }) {
  const [draft, setDraft] = useState(() => fromTts(model));
  useEffect(() => setDraft(fromTts(model)), [model]);
  return (
    <TtsForm
      title={model.displayName || model.name}
      draft={draft}
      onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
      onSaved={onChange}
      onRemove={async () => {
        if (!window.confirm(`Удалить «${model.displayName || model.name}»?`)) return;
        onChange(await removeTtsModel({ data: model.name }));
        toast("Модель удалена");
      }}
    />
  );
}

function TtsForm({
  title,
  draft,
  onChange,
  onSaved,
  onRemove,
}: {
  title: string;
  draft: TtsDraft;
  onChange: (patch: Partial<TtsDraft>) => void;
  onSaved: (rows: AdminTtsModel[]) => void;
  onRemove?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    const name = draft.name.trim();
    if (!name || name.length > 80 || !MODEL_RE.test(name)) {
      toast.error("Имя модели голоса: латиница, цифры и . _ : / -");
      return;
    }
    setBusy(true);
    try {
      const rows = await saveTtsModel({
        data: {
          name,
          previousName: draft.previousName,
          displayName: draft.displayName.trim() || name,
          baseUrl: draft.baseUrl.trim(),
          apiKey: draft.apiKey.trim(),
          clearKey: draft.clearKey,
          voice: draft.voice.trim() || "alloy",
        },
      });
      onSaved(rows);
      toast("Модель сохранена");
    } catch (error) {
      toast.error(messageOf(error, "Модель не сохранилась"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-elev p-3">
      <h4 className="text-sm font-medium">{title}</h4>
      <label className="mt-3 block text-xs text-faint">
        Название в списке
        <input className="field mt-1" value={draft.displayName} maxLength={48} placeholder="OpenAI TTS" onChange={(event) => onChange({ displayName: event.target.value })} />
      </label>
      <label className="mt-2 block text-xs text-faint">
        Модель
        <input className="field mt-1 font-mono text-sm" value={draft.name} maxLength={80} placeholder="tts-1" onChange={(event) => onChange({ name: event.target.value })} />
      </label>
      <label className="mt-2 block text-xs text-faint">
        Голос
        <input className="field mt-1 font-mono text-sm" value={draft.voice} maxLength={40} placeholder="alloy" onChange={(event) => onChange({ voice: event.target.value })} />
      </label>
      <label className="mt-2 block text-xs text-faint">
        Эндпойнт
        <input className="field mt-1 font-mono text-sm" value={draft.baseUrl} maxLength={300} onChange={(event) => onChange({ baseUrl: event.target.value })} />
      </label>
      <label className="mt-2 block text-xs text-faint">
        Ключ
        <SecretInput className="mt-1 font-mono text-sm" value={draft.apiKey} maxLength={400} autoComplete="off" label="Ключ модели голоса" placeholder={draft.hasKey && !draft.clearKey ? "Сохранён, введите новый чтобы заменить" : "Ключ"} onChange={(apiKey) => onChange({ apiKey, clearKey: false })} />
      </label>
      {draft.hasKey ? (
        <label className="mt-2 flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={draft.clearKey} onChange={(event) => onChange({ clearKey: event.target.checked, apiKey: event.target.checked ? "" : draft.apiKey })} />
          Убрать сохранённый ключ
        </label>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy} className="press h-10 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40" onClick={() => void save()}>
          Сохранить
        </button>
        {onRemove ? (
          <button
            type="button"
            disabled={busy}
            className="press h-10 rounded-xl border border-line px-3 text-sm text-danger disabled:opacity-40"
            onClick={() => {
              setBusy(true);
              void onRemove()
                .catch((error: unknown) => toast.error(messageOf(error, "Не удалось удалить")))
                .finally(() => setBusy(false));
            }}
          >
            Удалить
          </button>
        ) : null}
      </div>
    </section>
  );
}

function Journal() {
  const [rows, setRows] = useState<AttemptRow[] | null>(null);
  const [span, setSpan] = useState<5 | 30>(5);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let dead = false;
    setRows(null);
    void listAttempts({ data: { days: span } })
      .then((next) => {
        if (!dead) setRows(next);
      })
      .catch((error: unknown) => {
        if (!dead) toast.error(messageOf(error, "Журнал не открылся"));
      });
    return () => {
      dead = true;
    };
  }, [span]);
  if (!rows) return <PageLoader />;
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          <button type="button" className={span === 5 ? "press h-9 rounded-xl bg-subtle px-3 text-xs" : "press h-9 rounded-xl px-3 text-xs text-muted"} onClick={() => setSpan(5)}>
            5 дней
          </button>
          <button type="button" className={span === 30 ? "press h-9 rounded-xl bg-subtle px-3 text-xs" : "press h-9 rounded-xl px-3 text-xs text-muted"} onClick={() => setSpan(30)}>
            30 дней
          </button>
        </div>
        <button
          type="button"
          disabled={busy}
          className="press h-9 rounded-xl border border-line px-3 text-xs disabled:opacity-40"
          onClick={() => {
            if (!window.confirm("Очистить журнал попыток?")) return;
            setBusy(true);
            void clearAttempts()
              .then(() => {
                setRows([]);
                toast("Журнал очищен");
              })
              .catch((error: unknown) => toast.error(messageOf(error, "Не удалось очистить")))
              .finally(() => setBusy(false));
          }}
        >
          Очистить
        </button>
      </div>
      {rows.length === 0 ? <p className="mt-3 text-sm text-muted">За этот срок пусто.</p> : null}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="px-2 py-1 font-medium">Кто</th>
              <th className="px-2 py-1 font-medium">Модель</th>
              <th className="px-2 py-1 font-medium">Время</th>
              <th className="px-2 py-1 font-medium">Статус</th>
              <th className="px-2 py-1 font-medium">Запрос</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-2 py-1 align-top">{row.who}</td>
                <td className="px-2 py-1 align-top">{row.model}</td>
                <td className="px-2 py-1 align-top text-xs text-faint whitespace-nowrap">{when(row.createdAt)}</td>
                <td className="px-2 py-1 align-top">
                  {row.ok ? <span className="text-xs text-muted">ок</span> : <span className="rounded-full px-2 text-xs text-danger">ошибка</span>}
                </td>
                <td className="px-2 py-1 align-top text-muted">{row.note || row.mode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stats() {
  const [row, setRow] = useState<ChatStats | null>(null);
  useEffect(() => {
    let dead = false;
    void chatStats()
      .then((next) => {
        if (!dead) setRow(next);
      })
      .catch((error: unknown) => {
        if (!dead) toast.error(messageOf(error, "Статистика не открылась"));
      });
    return () => {
      dead = true;
    };
  }, []);
  if (!row) return <PageLoader />;
  const maxTokens = Math.max(1, ...row.days.map((item) => item.tokens), ...row.models.map((item) => item.tokens));
  const num = (value: number) => value.toLocaleString("ru-RU");
  return (
    <div className="mt-4">
      <p className="text-xs text-faint">Чат с ИИ · последние 14 дней</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-[1.4rem] border border-line bg-elev px-4 py-3">
          <p className="text-xs tracking-[0.16em] text-faint uppercase">Запросы</p>
          <p className="mt-1 font-serif text-4xl tabular-nums">{num(row.requests)}</p>
        </div>
        <div className="rounded-[1.4rem] border border-line bg-elev px-4 py-3">
          <p className="text-xs tracking-[0.16em] text-faint uppercase">Прошли</p>
          <p className="mt-1 font-serif text-4xl tabular-nums">{num(row.ok)}</p>
        </div>
        <div className="rounded-[1.4rem] border border-line bg-elev px-4 py-3">
          <p className="text-xs tracking-[0.16em] text-faint uppercase">Токены</p>
          <p className="mt-1 font-serif text-4xl tabular-nums">{num(row.tokens)}</p>
        </div>
      </div>
      <section className="mt-4 rounded-[1.4rem] border border-line bg-elev p-4">
        <h4 className="text-sm font-medium">По дням</h4>
        <p className="mt-1 text-xs text-muted">запросы · токены</p>
        {row.days.length === 0 ? <p className="mt-2 text-sm text-muted">Пока пусто.</p> : null}
        <ul className="mt-3 space-y-2">
          {row.days.map((item) => (
            <li key={item.day} className="grid grid-cols-[3.2rem_1fr_auto] items-center gap-2 text-xs">
              <span className="text-faint tabular-nums">{item.day}</span>
              <span className="h-2 overflow-hidden rounded-full bg-subtle">
                <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(6, (item.tokens / maxTokens) * 100)}%` }} />
              </span>
              <span className="tabular-nums text-muted">{num(item.requests)} · {num(item.tokens)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-3 rounded-[1.4rem] border border-line bg-elev p-4">
        <h4 className="text-sm font-medium">По моделям</h4>
        <p className="mt-1 text-xs text-muted">запросы · токены</p>
        {row.models.length === 0 ? <p className="mt-2 text-sm text-muted">Пока пусто.</p> : null}
        <ul className="mt-3 space-y-3">
          {row.models.map((item) => (
            <li key={item.model}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate text-sm">{item.model}</p>
                <p className="shrink-0 text-xs tabular-nums text-faint">{num(item.requests)} · {num(item.tokens)}</p>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-subtle">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(4, (item.tokens / maxTokens) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
