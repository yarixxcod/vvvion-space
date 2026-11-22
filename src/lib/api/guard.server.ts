import { getSql } from "@/lib/db";
import { loadAccess } from "@/lib/social/access";
import { isPremium } from "@/lib/social/premium";
import { judgeGuard } from "@/lib/api/guard-order";
import type { ApiDialect } from "@/lib/api/errors";
import { apiError, limitHeaders } from "@/lib/api/http";
import { authenticate } from "@/lib/api/keys.server";
import { readApiSettings, type ApiSettings } from "@/lib/api/settings.server";

export type ApiFinish = (row: {
  status: number;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  images?: number;
  estimated?: boolean;
}) => Promise<void>;

export type GuardOk = {
  ok: true;
  requestId: string;
  userId: string;
  keyId: string;
  settings: ApiSettings;
  dialect: ApiDialect;
  finish: ApiFinish;
  headers: Record<string, string>;
};

function dialectOf(request: Request): ApiDialect {
  return new URL(request.url).pathname.includes("/v1/messages") ? "anthropic" : "openai";
}

export async function guardRequest(request: Request, kind: "chat" | "image" | "models" | "count"): Promise<GuardOk | { ok: false; response: Response }> {
  const requestId = crypto.randomUUID();
  const dialect = dialectOf(request);
  const settings = await readApiSettings();
  const auth = await authenticate(request);
  let admin = false;
  let banned = false;
  let suspended = false;
  let premium = false;
  if (auth) {
    const access = await loadAccess(auth.userId);
    banned = access.banned;
    admin = access.role === "admin" && !banned;
    premium = await isPremium(auth.userId);
    try {
      const sql = await getSql();
      const rows = await sql<{ until: string | null }>`
        select suspended_until::text as until from account_limits
        where user_id = ${auth.userId} and suspended_until > now() limit 1
      `;
      suspended = Boolean(rows[0]);
    } catch (error) {
      if (error instanceof Error && error.message === "Аккаунт временно ограничен") throw error;
    }
  }
  const early = judgeGuard({
    serviceEnabled: settings.enabled,
    authenticated: Boolean(auth),
    admin,
    banned,
    suspended,
    premium,
    minuteCount: 0,
    minuteLimit: settings.perMinute,
    dailyRequests: null,
    dailyRequestsUsed: 0,
    dailyTokens: null,
    dailyTokensUsed: 0,
    dailyImages: null,
    dailyImagesUsed: 0,
    imageRequest: false,
  });
  if (!early.ok) {
    return { ok: false, response: apiError(dialect, early.status, early.code, requestId, undefined, limitHeaders(settings.perMinute, settings.perMinute, early.retryAfter)) };
  }
  if (!auth) {
    return { ok: false, response: apiError(dialect, 401, "invalid_api_key", requestId) };
  }
  const sql = await getSql();
  const endpoint = new URL(request.url).pathname.slice(0, 80);
  const inserted = await sql<{ id: string }>`
    insert into api_usage (key_id, user_id, endpoint, model, status)
    values (${auth.keyId}, ${auth.userId}, ${endpoint}, ${""}, 0)
    returning id::text as id
  `;
  const usageId = inserted[0]?.id || "";
  const started = Date.now();
  const finish: ApiFinish = async (row) => {
    if (!usageId) return;
    try {
      await sql`
        update api_usage set
          status = ${row.status},
          model = ${(row.model || "").slice(0, 120)},
          prompt_tokens = ${Math.max(0, Math.round(row.promptTokens || 0))},
          completion_tokens = ${Math.max(0, Math.round(row.completionTokens || 0))},
          images = ${Math.max(0, Math.round(row.images || 0))},
          latency_ms = ${Math.max(0, Date.now() - started)},
          estimated = ${row.estimated === true}
        where id = ${usageId}
      `;
    } catch (error) {
      console.error("[api] usage", error instanceof Error ? error.message : "update failed");
    }
  };
  const minute = await sql<{ n: number }>`
    select count(*)::int as n from api_usage
    where user_id = ${auth.userId} and created_at > now() - interval '60 seconds'
  `;
  const daily = await sql<{ requests: number; tokens: number; images: number }>`
    select count(*)::int as requests,
           coalesce(sum(prompt_tokens + completion_tokens), 0)::int as tokens,
           coalesce(sum(images), 0)::int as images
    from api_usage
    where user_id = ${auth.userId} and created_at > now() - interval '24 hours'
  `;
  const verdict = judgeGuard({
    serviceEnabled: settings.enabled,
    authenticated: true,
    admin,
    banned,
    suspended,
    premium,
    minuteCount: Number(minute[0]?.n ?? 0),
    minuteLimit: settings.perMinute,
    dailyRequests: settings.dailyRequests,
    dailyRequestsUsed: Number(daily[0]?.requests ?? 0),
    dailyTokens: settings.dailyTokens,
    dailyTokensUsed: Number(daily[0]?.tokens ?? 0),
    dailyImages: settings.dailyImages,
    dailyImagesUsed: Number(daily[0]?.images ?? 0),
    imageRequest: kind === "image",
  });
  const headers = limitHeaders(settings.perMinute, verdict.ok ? verdict.minuteRemaining : 0, verdict.ok ? undefined : verdict.retryAfter);
  if (!verdict.ok) {
    await finish({ status: verdict.status });
    return { ok: false, response: apiError(dialect, verdict.status, verdict.code, requestId, undefined, headers) };
  }
  return { ok: true, requestId, userId: auth.userId, keyId: auth.keyId, settings, dialect, finish, headers };
}
