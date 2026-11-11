import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertAdmin } from "@/lib/social/access";
import { isPremium } from "@/lib/social/premium";

export type UsagePolicy = {
  dailyRequests: number | null;
  dailyTokens: number | null;
};

export type LimitDecision = {
  blocked: boolean;
  message: string;
  remainingPct: number | null;
};

function cleanCap(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw new Error("Лимит — целое число или пустое поле");
  return n;
}

export async function readUsagePolicy(): Promise<UsagePolicy> {
  const sql = await getSql();
  const rows = await sql<{ daily_requests: number | null; daily_tokens: number | null }>`
    select daily_requests, daily_tokens from usage_policy where id = 1 limit 1
  `;
  return {
    dailyRequests: rows[0]?.daily_requests ?? null,
    dailyTokens: rows[0]?.daily_tokens ?? null,
  };
}

export async function enforceDailyLimit(userId: string): Promise<LimitDecision> {
  const policy = await readUsagePolicy();
  if (policy.dailyRequests == null && policy.dailyTokens == null) {
    return { blocked: false, message: "", remainingPct: null };
  }
  const sql = await getSql();
  const rows = await sql<{ requests: number; tokens: number }>`
    select count(*)::int as requests,
           coalesce(sum(total_tokens), 0)::int as tokens
    from chat_attempts
    where user_id = ${userId}
      and ok = true
      and created_at > now() - interval '24 hours'
  `;
  const boosts = await sql<{ extra: number }>`
    select coalesce(sum(extra_requests), 0)::int as extra
    from limit_boosts
    where user_id = ${userId}
      and expires_at > now()
  `;
  const premium = await isPremium(userId);
  const extraRequests = Number(boosts[0]?.extra ?? 0);
  const baseRequests = policy.dailyRequests == null ? null : policy.dailyRequests * (premium ? 2 : 1);
  const tokenCap = policy.dailyTokens == null ? null : policy.dailyTokens * (premium ? 2 : 1);
  const requestCap = baseRequests == null ? null : baseRequests + extraRequests;
  const usedRequests = Number(rows[0]?.requests ?? 0);
  const usedTokens = Number(rows[0]?.tokens ?? 0);
  const requestLeft = requestCap == null ? null : requestCap - usedRequests;
  const tokenLeft = tokenCap == null ? null : tokenCap - usedTokens;
  if ((requestLeft != null && requestLeft <= 0) || (tokenLeft != null && tokenLeft <= 0)) {
    return {
      blocked: true,
      message: premium
        ? "Дневной лимит подписки закончился. Новые запросы откроются через сутки."
        : "Дневной лимит закончился. Новые запросы откроются через сутки. С подпиской лимит вдвое выше.",
      remainingPct: 0,
    };
  }
  const percents: number[] = [];
  if (requestCap != null && requestCap > 0) {
    percents.push(Math.round(((requestCap - (usedRequests + 1)) / requestCap) * 100));
  }
  if (tokenCap != null && tokenCap > 0) {
    percents.push(Math.round(((tokenCap - usedTokens) / tokenCap) * 100));
  }
  const remainingPct = percents.length ? Math.max(0, Math.min(...percents)) : null;
  return { blocked: false, message: "", remainingPct };
}

export const getUsagePolicy = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<UsagePolicy> => {
    await assertAdmin(context.userId);
    return readUsagePolicy();
  });

export const saveUsagePolicy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { dailyRequests?: unknown; dailyTokens?: unknown }) : {};
    return {
      dailyRequests: cleanCap(raw.dailyRequests),
      dailyTokens: cleanCap(raw.dailyTokens),
    };
  })
  .handler(async ({ context, data }): Promise<UsagePolicy> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    await sql`
      insert into usage_policy (id, daily_requests, daily_tokens)
      values (1, ${data.dailyRequests}, ${data.dailyTokens})
      on conflict (id) do update
        set daily_requests = excluded.daily_requests,
            daily_tokens = excluded.daily_tokens
    `;
    return data;
  });
