import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { TONES, TOPICS } from "@/lib/ai/interest-topics";

export type InterestProfile = {
  known: boolean;
  topics: string[];
  tone: string;
  skipped: boolean;
};

const TOPIC_IDS = new Set(TOPICS.map((topic) => topic.id));
const TONE_IDS = new Set<string>(TONES.map((tone) => tone.id));

function cleanTopics(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !TOPIC_IDS.has(item) || out.includes(item)) continue;
    out.push(item);
    if (out.length === 8) break;
  }
  return out;
}

function cleanTone(value: unknown): string {
  return typeof value === "string" && TONE_IDS.has(value) ? value : "clear";
}

function parseSave(input: unknown): { topics: string[]; tone: string; skipped: boolean } {
  if (!input || typeof input !== "object") throw new Error("Не получилось сохранить интересы");
  const raw = input as Record<string, unknown>;
  const skipped = raw.skipped === true;
  const topics = cleanTopics(raw.topics);
  if (!skipped && topics.length === 0) throw new Error("Выберите хотя бы одну тему");
  return { topics, tone: cleanTone(raw.tone), skipped };
}

function profileFrom(row: { topics: string; tone: string; skipped: boolean } | undefined): InterestProfile {
  if (!row) return { known: false, topics: [], tone: "clear", skipped: false };
  return {
    known: true,
    topics: cleanTopics(row.topics.split(",").filter(Boolean)),
    tone: cleanTone(row.tone),
    skipped: Boolean(row.skipped),
  };
}

export const getInterests = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<InterestProfile> => {
    const sql = await getSql();
    const rows = await sql<{ topics: string; tone: string; skipped: boolean }>`
      select topics, tone, skipped from user_interests where user_id = ${context.userId} limit 1
    `;
    return profileFrom(rows[0]);
  });

export const saveInterests = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(parseSave)
  .handler(async ({ context, data }): Promise<InterestProfile> => {
    const sql = await getSql();
    const topics = data.topics.join(",");
    await sql`
      insert into user_interests (user_id, topics, tone, skipped, updated_at)
      values (${context.userId}, ${topics}, ${data.tone}, ${data.skipped}, now())
      on conflict (user_id) do update set
        topics = excluded.topics,
        tone = excluded.tone,
        skipped = excluded.skipped,
        updated_at = now()
    `;
    return { known: true, topics: data.topics, tone: data.tone, skipped: data.skipped };
  });
