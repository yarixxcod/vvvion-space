import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { grantAchievement } from "@/lib/social/achievements";
import { assertActive } from "@/lib/social/access";

export type ProfileFacts = {
  country: string;
  city: string;
  birthDate: string;
};

function place(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim().slice(0, 48);
  if (text && !/^[\p{L}\p{N} .,'’()\-/]+$/u.test(text)) throw new Error("Страна и город: буквы, цифры и пробел");
  return text;
}

function birth(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("Дата рождения: день, месяц и год");
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new Error("Такой даты нет");
  const year = Number(text.slice(0, 4));
  if (year < 1900 || date.getTime() > Date.now()) throw new Error("Дата рождения не может быть в будущем");
  return text;
}

async function readFacts(userId: string): Promise<ProfileFacts> {
  const sql = await getSql();
  const rows = await sql<{ country: string | null; city: string | null; birth_date: string | null }>`
    select country, city, birth_date from profile_facts where user_id = ${userId}
  `;
  return {
    country: rows[0]?.country || "",
    city: rows[0]?.city || "",
    birthDate: rows[0]?.birth_date || "",
  };
}

export const getProfileFacts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ProfileFacts> => {
    await assertActive(context.userId);
    return readFacts(context.userId);
  });

export const saveProfileFacts = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): ProfileFacts => {
    const raw = input && typeof input === "object" ? (input as { country?: unknown; city?: unknown; birthDate?: unknown }) : {};
    return { country: place(raw.country), city: place(raw.city), birthDate: birth(raw.birthDate) };
  })
  .handler(async ({ context, data }): Promise<ProfileFacts> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const birthDate = data.birthDate || null;
    await sql`
      insert into profile_facts (user_id, country, city, birth_date, updated_at)
      values (${context.userId}, ${data.country}, ${data.city}, ${birthDate}, now())
      on conflict (user_id) do update
        set country = ${data.country},
            city = ${data.city},
            birth_date = ${birthDate},
            updated_at = now()
    `;
    if (data.country || data.city) void grantAchievement(context.userId, "place");
    return data;
  });

export const searchPlaceCities = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { iso?: unknown; query?: unknown }) : {};
    const iso = typeof raw.iso === "string" ? raw.iso.trim().toUpperCase() : "";
    const query = typeof raw.query === "string" ? raw.query.replace(/\s+/g, " ").trim().slice(0, 40) : "";
    if (!/^[A-Z]{2}$/.test(iso) || query.length < 2) throw new Error("Сначала выберите страну и введите город");
    return { iso, query };
  })
  .handler(async ({ data }): Promise<{ id: string; name: string; region: string }[]> => {
    let response: Response;
    try {
      response = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(data.query)}&count=8&language=ru&countryCode=${data.iso}`,
        { signal: AbortSignal.timeout(8_000) },
      );
    } catch {
      return [];
    }
    if (!response.ok) return [];
    const payload = (await response.json()) as { results?: { id?: number; name?: string; admin1?: string }[] };
    return (payload.results ?? [])
      .filter((row) => row.name)
      .map((row) => ({ id: String(row.id ?? row.name), name: row.name || "", region: row.admin1 || "" }));
  });
