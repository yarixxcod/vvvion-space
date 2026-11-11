import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertActive } from "@/lib/social/access";
import { localWear, parseWttr, type WeatherCard } from "@/lib/weather/parse";

const MAX_CITIES = 8;

function cleanCity(value: unknown): string {
  if (typeof value !== "string") throw new Error("Напишите название города");
  const city = value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .,'-]{1,59}$/u.test(city)) throw new Error("Такое название города не подойдёт");
  return city;
}

async function fetchWttr(city: string): Promise<Omit<WeatherCard, "advice">> {
  let response: Response;
  try {
    response = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
      headers: { "user-agent": "curl/8.7.1", accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error("Погода сейчас не отвечает");
  }
  if (!response.ok) throw new Error("Город не нашёлся");
  const text = await response.text();
  if (text.length > 1_500_000 || text.trim().startsWith("<")) throw new Error("Город не нашёлся");
  try {
    return parseWttr(JSON.parse(text) as unknown, city);
  } catch (err) {
    if (err instanceof Error && err.message === "Город не нашёлся") throw err;
    throw new Error("Город не нашёлся");
  }
}

async function clothingAdvice(card: Omit<WeatherCard, "advice">): Promise<string> {
  const fallback = localWear(card);
  const cacheKey = `${card.city.toLocaleLowerCase("ru")}|${card.code}|${card.temp}|${card.days[0]?.label ?? ""}`.slice(0, 140);
  const sql = await getSql();
  const cached = await sql<{ advice: string }>`
    select advice from weather_advice
    where cache_key = ${cacheKey} and created_at > now() - interval '6 hours'
    limit 1
  `;
  if (cached[0]?.advice) return cached[0].advice;
  const key = process.env.XAI_API_KEY?.trim();
  let advice = fallback;
  if (key) {
    try {
      const response = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(12_000),
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: "grok-4.5",
          temperature: 0.4,
          max_tokens: 180,
          messages: [
            {
              role: "system",
              content:
                "Ты пишешь короткий совет, что надеть по погоде. Два или три спокойных предложения по-русски, без списков, без emoji и без упоминания, что ты модель. Учитывай температуру, ощущение, ветер и осадки.",
            },
            {
              role: "user",
              content: `Город: ${card.city}. Сейчас ${card.temp}°C, ощущается как ${card.feels}°C. ${card.desc}. Ветер ${card.wind} км/ч. Влажность ${card.humidity}%. Осадки ${card.precip} мм.${card.days[0] ? ` Днём до ${card.days[0].max}°C, ночью ${card.days[0].min}°C.` : ""}`,
            },
          ],
        }),
      });
      if (response.ok) {
        const json = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
        const text = json.choices?.[0]?.message?.content;
        if (typeof text === "string") {
          const clean = text.replace(/\s+/g, " ").trim();
          if (clean.length >= 12 && clean.length <= 500) advice = clean;
        }
      }
    } catch {
      advice = fallback;
    }
  }
  await sql`
    insert into weather_advice (cache_key, advice)
    values (${cacheKey}, ${advice})
    on conflict (cache_key) do update set advice = excluded.advice, created_at = now()
  `;
  return advice;
}

async function paint(city: string): Promise<WeatherCard> {
  const sky = await fetchWttr(city);
  const advice = await clothingAdvice(sky);
  return { ...sky, advice };
}

export const loadWeather = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<WeatherCard[]> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const rows = await sql<{ city: string }>`
      select city from weather_cities
      where user_id = ${context.userId}
      order by added_at desc
      limit ${MAX_CITIES}
    `;
    const cards = await Promise.all(
      rows.map(async (row) => {
        try {
          return await paint(row.city);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Погода сейчас не отвечает";
          return {
            city: row.city,
            place: row.city,
            temp: 0,
            feels: 0,
            code: 122,
            desc: message,
            wind: 0,
            humidity: 0,
            precip: 0,
            hours: [],
            days: [],
            advice: "",
          } satisfies WeatherCard;
        }
      }),
    );
    return cards;
  });

export const watchCity = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { city?: unknown }).city : input;
    return { city: cleanCity(raw) };
  })
  .handler(async ({ context, data }): Promise<WeatherCard> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const have = await sql<{ city: string }>`
      select city from weather_cities
      where user_id = ${context.userId} and lower(city) = lower(${data.city})
      limit 1
    `;
    if (!have.length) {
      const count = await sql<{ n: number }>`
        select count(*)::int as n from weather_cities where user_id = ${context.userId}
      `;
      if (Number(count[0]?.n) >= MAX_CITIES) throw new Error("Можно следить не больше чем за восемью городами");
    }
    const card = await paint(have[0]?.city ?? data.city);
    if (!have.length) {
      await sql`
        insert into weather_cities (user_id, city)
        values (${context.userId}, ${data.city})
      `;
    }
    return { ...card, city: have[0]?.city ?? data.city };
  });

export const forgetCity = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { city?: unknown }).city : input;
    return { city: cleanCity(raw) };
  })
  .handler(async ({ context, data }): Promise<void> => {
    await assertActive(context.userId);
    const sql = await getSql();
    await sql`
      delete from weather_cities
      where user_id = ${context.userId} and lower(city) = lower(${data.city})
    `;
  });
