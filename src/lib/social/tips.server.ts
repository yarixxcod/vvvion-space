import { getSql } from "@/lib/db";

export type Tip = { kicker: string; title: string; text: string };

const FALLBACK: Tip[] = [
  { kicker: "Утро", title: "Одно своё дело", text: "Пусть сегодня получится хотя бы одно дело, которое выбрали вы сами." },
  { kicker: "Пауза", title: "Сначала выдох", text: "Перед следующим вопросом остановитесь на вдох. Ясная мысль редко приходит в спешке." },
  { kicker: "Вечер", title: "День можно закрыть", text: "Оставьте одну строку на завтра и отложите остальное." },
  { kicker: "Письмо", title: "Черновик подождёт", text: "Если текст злит, не отправляйте сразу. Вернитесь через час." },
  { kicker: "Шаг", title: "Только первая строка", text: "Если план пугает, сделайте самый маленький шаг." },
];

function cleanTip(value: unknown): Tip | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { kicker?: unknown; title?: unknown; text?: unknown };
  const kicker = typeof row.kicker === "string" ? row.kicker.replace(/\s+/g, " ").trim().slice(0, 24) : "";
  const title = typeof row.title === "string" ? row.title.replace(/\s+/g, " ").trim().slice(0, 48) : "";
  const text = typeof row.text === "string" ? row.text.replace(/\s+/g, " ").trim().slice(0, 140) : "";
  if (title.length < 2 || text.length < 8) return null;
  return { kicker: kicker || "Совет", title, text };
}

function parseTips(raw: string): Tip[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(cleanTip).filter((item): item is Tip => Boolean(item)).slice(0, 5);
  } catch {
    return [];
  }
}

async function targets(): Promise<{ name: string; url: string; key: string; model: string }[]> {
  const sql = await getSql();
  const rows = await sql<{ name: string; base_url: string | null; api_key: string | null; model_id: string | null }>`
    select m.name,
           coalesce(nullif(p.base_url, ''), nullif(m.base_url, '')) as base_url,
           coalesce(nullif(p.api_key, ''), nullif(m.api_key, '')) as api_key,
           coalesce(nullif(p.model_id, ''), m.name) as model_id
    from catalog_models m
    left join catalog_providers p on p.model_name = m.name
  `;
  const list = rows
    .map((row) => ({
      name: row.name,
      url: (row.base_url || "https://api.x.ai/v1").replace(/\/$/, "") + "/chat/completions",
      key: row.api_key || "",
      model: row.model_id || row.name,
    }))
    .filter((row) => row.key && row.model);
  if (list.length) return list;
  const key = process.env.XAI_API_KEY?.trim() || "";
  if (!key) return [];
  return [{ name: "grok-4.5", url: "https://api.x.ai/v1/chat/completions", key, model: "grok-4.5" }];
}

async function ask(target: { url: string; key: string; model: string }): Promise<Tip[]> {
  const res = await fetch(target.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${target.key}` },
    body: JSON.stringify({
      model: target.model,
      temperature: 0.9,
      max_tokens: 500,
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "Ты пишешь короткие спокойные советы на русском. Без рекламы, без названия сервиса, без морали и восклицаний. Ответ — только JSON-массив из 5 объектов {kicker, title, text}. kicker — одно слово, title — до 5 слов, text — одно предложение до 120 знаков.",
        },
        { role: "user", content: "Пять разных советов на сегодня: утро, пауза, разговор, дело и вечер." },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return parseTips(data.choices?.[0]?.message?.content || "");
}

export async function readTips(): Promise<{ items: Tip[]; at: string | null }> {
  const sql = await getSql();
  const rows = await sql<{ items: Tip[] | string; created_at: string }>`
    select items, created_at::text as created_at from daily_tips where id = 1
  `;
  const row = rows[0];
  if (!row) return { items: FALLBACK, at: null };
  const items = Array.isArray(row.items) ? row.items.map(cleanTip).filter((item): item is Tip => Boolean(item)) : parseTips(String(row.items));
  return { items: items.length ? items : FALLBACK, at: row.created_at };
}

export async function refreshTipsIfDue() {
  const sql = await getSql();
  const fresh = await sql<{ ok: number }>`
    select 1 as ok from daily_tips where id = 1 and created_at > now() - interval '24 hours'
  `;
  if (fresh.length) return;
  const pool = await targets();
  if (!pool.length) return;
  const target = pool[Math.floor(Math.random() * pool.length)];
  let items: Tip[] = [];
  try {
    items = await ask(target);
  } catch {
    items = [];
  }
  if (items.length < 3) return;
  await sql`
    insert into daily_tips (id, model, items, created_at)
    values (1, ${target.name}, ${JSON.stringify(items)}::jsonb, now())
    on conflict (id) do update
      set model = ${target.name}, items = ${JSON.stringify(items)}::jsonb, created_at = now()
  `;
}
