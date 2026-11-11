import { importPKCS8, SignJWT } from "jose";
import { getSql } from "@/lib/db";
import { auth } from "@/lib/auth/server";
import { senderName } from "@/lib/social/telegram.server";
import { stickerCode } from "@/lib/stickers";
import {
  clipText,
  inQuietHours,
  pushPriority,
  pushTtl,
  PUSH_DEFAULTS,
  settingsFrom,
  subCopy,
  subKind,
  subRef,
  validPushPath,
  validPushToken,
  type PushKind,
  type PushSettings,
  type SubProduct,
  type SubWindow,
} from "@/lib/social/push-policy";

type ServiceAccount = { client_email: string; private_key: string; project_id?: string };

const hits = new Map<string, { n: number; reset: number }>();
let accessToken = "";
let accessUntil = 0;
let warned = false;

export function allowPush(key: string, limit = 30, windowMs = 10 * 60_000) {
  const now = Date.now();
  const row = hits.get(key);
  if (!row || now > row.reset) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  if (row.n >= limit) return false;
  row.n += 1;
  return true;
}

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim().slice(0, 80) || "local";
  return "local";
}

export function pushLimitKey(request: Request, userId: string, action: string) {
  return `${action}:${userId}:${clientIp(request)}`;
}

export async function userIdFromRequest(request: Request): Promise<string | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  const id = session?.user?.id;
  return typeof id === "string" && id ? id : null;
}

function parseAccount(raw: string): ServiceAccount | null {
  try {
    const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const json = JSON.parse(text) as ServiceAccount;
    if (!json?.client_email || !json?.private_key) return null;
    return json;
  } catch {
    return null;
  }
}

async function bundledRaw(): Promise<string> {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const paths = [
    join(process.cwd(), ".data", "firebase-admin.json"),
    join(process.cwd(), "firebase-admin.json"),
    join(process.cwd(), ".output", "firebase-admin.json"),
    join(process.cwd(), ".output", "server", "firebase-admin.json"),
  ];
  for (const path of paths) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      /* the key lives in only one of these places */
    }
  }
  return "";
}

async function serviceAccount(): Promise<ServiceAccount | null> {
  const fromEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (fromEnv) {
    const parsed = parseAccount(fromEnv);
    if (parsed) return parsed;
  }
  const raw = await bundledRaw();
  if (!raw) return null;
  const bundled = parseAccount(raw);
  if (!bundled) return null;
  if (bundled.project_id && bundled.project_id !== "space-vvvion-app") return null;
  return bundled;
}

function noteUnconfigured() {
  if (warned) return;
  warned = true;
  console.error("push skipped", "unconfigured");
}

async function fcmToken(account: ServiceAccount) {
  const now = Date.now();
  if (accessToken && accessUntil - 60_000 > now) return accessToken;
  const key = await importPKCS8(account.private_key, "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    console.error("push failed", "oauth");
    return "";
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return "";
  accessToken = json.access_token;
  accessUntil = now + Math.max(60, Number(json.expires_in) || 3600) * 1000;
  return accessToken;
}

async function deleteToken(token: string) {
  const sql = await getSql();
  await sql`delete from push_tokens where token = ${token}`;
}

export async function getPushSettings(userId: string): Promise<PushSettings> {
  const sql = await getSql();
  const rows = await sql<PushSettings>`
    select messages, ai, subs, money, security, system, preview,
           quiet_from as "quietFrom", quiet_to as "quietTo"
    from push_settings where user_id = ${userId}
  `;
  return settingsFrom(rows[0] ?? PUSH_DEFAULTS);
}

export async function savePushSettings(userId: string, next: PushSettings) {
  const sql = await getSql();
  const saved = settingsFrom(next);
  await sql`
    insert into push_settings (user_id, messages, ai, subs, money, security, system, preview, quiet_from, quiet_to)
    values (
      ${userId}, ${saved.messages}, ${saved.ai}, ${saved.subs}, ${saved.money}, true, ${saved.system}, ${saved.preview},
      ${saved.quietFrom}, ${saved.quietTo}
    )
    on conflict (user_id) do update
      set messages = ${saved.messages},
          ai = ${saved.ai},
          subs = ${saved.subs},
          money = ${saved.money},
          security = true,
          system = ${saved.system},
          preview = ${saved.preview},
          quiet_from = ${saved.quietFrom},
          quiet_to = ${saved.quietTo}
  `;
}

async function seenRecently(userId: string) {
  const sql = await getSql();
  const rows = await sql<{ ok: number }>`
    select 1 as ok from user_presence
    where user_id = ${userId} and last_seen_at > now() - interval '30 seconds'
    limit 1
  `;
  return Boolean(rows[0]);
}

export async function touchPresence(userId: string) {
  const sql = await getSql();
  await sql`
    insert into user_presence (user_id, last_seen_at)
    values (${userId}, now())
    on conflict (user_id) do update set last_seen_at = now()
  `;
}

export async function registerPushToken(userId: string, token: string, appVersion: string) {
  if (!validPushToken(token)) return;
  const version = clipText(appVersion, 32);
  const sql = await getSql();
  const id = crypto.randomUUID();
  await sql`
    insert into push_tokens (id, user_id, token, platform, app_version, created_at, last_seen_at)
    values (${id}, ${userId}, ${token}, 'android', ${version}, now(), now())
    on conflict (token) do update
      set user_id = ${userId},
          platform = 'android',
          app_version = ${version},
          last_seen_at = now()
  `;
  await sql`
    with keep as (
      select token from push_tokens
      where user_id = ${userId}
      order by last_seen_at desc
      limit 10
    )
    delete from push_tokens
    where user_id = ${userId}
      and token not in (select token from keep)
  `;
}

export async function unregisterPushToken(userId: string, token: string) {
  if (!validPushToken(token)) return;
  const sql = await getSql();
  await sql`delete from push_tokens where token = ${token} and user_id = ${userId}`;
}

async function claimDialog(userId: string, dialogId: string) {
  const sql = await getSql();
  const rows = await sql<{ user_id: string }>`
    insert into push_dialog_gate (user_id, dialog_id, sent_at)
    values (${userId}, ${dialogId}, now())
    on conflict (user_id, dialog_id) do update
      set sent_at = now()
      where push_dialog_gate.sent_at < now() - interval '10 seconds'
    returning user_id
  `;
  return rows.length > 0;
}

async function claimOnce(userId: string, kind: string, refId: string) {
  const sql = await getSql();
  const rows = await sql<{ user_id: string }>`
    insert into push_log (user_id, kind, ref_id, sent_at)
    values (${userId}, ${kind}, ${refId}, now())
    on conflict (user_id, kind, ref_id) do nothing
    returning user_id
  `;
  return rows.length > 0;
}

export async function sendPush(
  userId: string,
  kind: PushKind,
  payload: { id: string; title: string; body: string; url: string },
) {
  if (!validPushPath(payload.url)) return;
  const settings = await getPushSettings(userId);
  if (kind !== "security" && !settings[kind]) return;
  if (kind !== "security" && inQuietHours(settings)) return;
  const account = await serviceAccount();
  const project = process.env.FIREBASE_PROJECT_ID?.trim() || account?.project_id || "";
  if (!account || !project) {
    noteUnconfigured();
    return;
  }
  const token = await fcmToken(account);
  if (!token) return;
  const sql = await getSql();
  const tokens = await sql<{ token: string }>`
    select token from push_tokens where user_id = ${userId} order by last_seen_at desc limit 10
  `;
  const data = {
    id: clipText(payload.id, 120),
    channel: kind,
    title: clipText(payload.title, 80) || "vvvion",
    body: clipText(payload.body, 180),
    url: payload.url,
  };
  for (const row of tokens) {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(project)}/messages:send`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: row.token,
            data,
            android: { priority: pushPriority(kind), ttl: pushTtl(kind) },
          },
        }),
      });
      if (res.ok) continue;
      const err = (await res.json().catch(() => null)) as {
        error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
      } | null;
      const status = err?.error?.status || String(res.status);
      const code = err?.error?.details?.find((item) => item?.errorCode)?.errorCode || "";
      const message = err?.error?.message || "";
      const dead =
        code === "UNREGISTERED" ||
        status === "NOT_FOUND" ||
        (status === "INVALID_ARGUMENT" && /registration token/i.test(message));
      if (dead) await deleteToken(row.token);
      else console.error("push failed", code || status);
    } catch {
      console.error("push failed", "network");
    }
  }
}

export async function pushRoomMessage(roomId: string, fromUserId: string, body: string, attached: boolean) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(roomId)) return;
  const sql = await getSql();
  const members = await sql<{ user_id: string }>`
    select user_id from room_members where room_id = ${roomId} and user_id <> ${fromUserId}
  `;
  if (!members.length) return;
  const name = clipText(await senderName(fromUserId), 80) || "Участник";
  const raw = stickerCode(body) ? "Стикер" : body.trim() || (attached ? "Вложение" : "Сообщение");
  const text = clipText(raw, 120) || "Новое сообщение";
  await Promise.all(
    members.map(async (member) => {
      const settings = await getPushSettings(member.user_id);
      if (!settings.messages) return;
      if (await seenRecently(member.user_id)) return;
      if (!(await claimDialog(member.user_id, roomId))) return;
      await sendPush(member.user_id, "messages", {
        id: `msg:${roomId}`,
        title: name,
        body: settings.preview ? text : "Новое сообщение",
        url: `/messages/${roomId}`,
      });
    }),
  );
}

export async function pushAiReady(userId: string, chatId: string, messageId: string, clientGone: boolean) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(chatId) || !/^[A-Za-z0-9_-]{8,80}$/.test(messageId)) return;
  if (!clientGone && (await seenRecently(userId))) return;
  const sql = await getSql();
  const rows = await sql<{ title: string | null }>`
    select title from saved_chats where id = ${chatId} and user_id = ${userId} limit 1
  `;
  const title = clipText(rows[0]?.title || "", 80) || "Чат с ИИ";
  await sendPush(userId, "ai", {
    id: `ai:${chatId}:${messageId}`,
    title,
    body: "Ответ готов",
    url: `/?chat=${chatId}`,
  });
}

export async function pushAiFail(userId: string, chatId: string, messageId: string, clientGone: boolean) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(chatId) || !/^[A-Za-z0-9_-]{8,80}$/.test(messageId)) return;
  if (!clientGone && (await seenRecently(userId))) return;
  await sendPush(userId, "ai", {
    id: `ai-fail:${chatId}:${messageId}`,
    title: "Не удалось получить ответ",
    body: "Попробуйте ещё раз или выберите другую модель",
    url: `/?chat=${chatId}`,
  });
}

export async function pushNotice(
  userId: string,
  kind: PushKind,
  payload: { id: string; title: string; body: string; url: string },
  once?: { kind: string; ref: string },
) {
  if (kind !== "security" && (await seenRecently(userId))) return;
  if (once && !(await claimOnce(userId, once.kind, once.ref))) return;
  await sendPush(userId, kind, payload);
}

async function remindProduct(product: SubProduct, window: SubWindow) {
  const sql = await getSql();
  const rows =
    window === "3d"
      ? product === "mega"
        ? await sql<{ user_id: string; until_at: string }>`
            select user_id, until_at::text as until_at from mega_grants
            where until_at > now() + interval '2 days' and until_at <= now() + interval '3 days'
          `
        : await sql<{ user_id: string; until_at: string }>`
            select user_id, until_at::text as until_at from premium_grants
            where until_at > now() + interval '2 days' and until_at <= now() + interval '3 days'
          `
      : product === "mega"
        ? await sql<{ user_id: string; until_at: string }>`
            select user_id, until_at::text as until_at from mega_grants
            where until_at > now() and until_at <= now() + interval '1 day'
          `
        : await sql<{ user_id: string; until_at: string }>`
            select user_id, until_at::text as until_at from premium_grants
            where until_at > now() and until_at <= now() + interval '1 day'
          `;
  const copy = subCopy(product, window);
  const kind = subKind(product, window);
  for (const row of rows) {
    const ends = new Date(row.until_at);
    if (Number.isNaN(ends.getTime())) continue;
    const ref = `${row.user_id}:${subRef(ends)}`;
    if (!(await claimOnce(row.user_id, kind, ref))) continue;
    await sendPush(row.user_id, "subs", { id: copy.id, title: copy.title, body: copy.body, url: copy.url });
  }
}

export async function runSubscriptionReminders() {
  await remindProduct("mega", "3d");
  await remindProduct("mega", "1d");
  await remindProduct("premium", "3d");
  await remindProduct("premium", "1d");
  await remindExpired("mega");
  await remindExpired("premium");
  await remindVpn("3d");
  await remindVpn("1d");
}

async function remindExpired(product: "mega" | "premium") {
  const sql = await getSql();
  const rows =
    product === "mega"
      ? await sql<{ user_id: string; until_at: string }>`
          select user_id, until_at::text as until_at from mega_grants
          where until_at > now() - interval '1 day' and until_at <= now()
        `
      : await sql<{ user_id: string; until_at: string }>`
          select user_id, until_at::text as until_at from premium_grants
          where until_at > now() - interval '1 day' and until_at <= now()
        `;
  const copy = subCopy(product, "expired");
  for (const row of rows) {
    const ends = new Date(row.until_at);
    if (Number.isNaN(ends.getTime())) continue;
    if (!(await claimOnce(row.user_id, subKind(product, "expired"), subRef(ends)))) continue;
    await sendPush(row.user_id, "subs", { id: copy.id, title: copy.title, body: copy.body, url: copy.url });
  }
}

async function remindVpn(window: "3d" | "1d") {
  const sql = await getSql();
  const rows =
    window === "3d"
      ? await sql<{ user_id: string; until_at: string }>`
          select user_id, until_at::text as until_at from vpn_passes
          where until_at > now() + interval '2 days' and until_at <= now() + interval '3 days'
        `
      : await sql<{ user_id: string; until_at: string }>`
          select user_id, until_at::text as until_at from vpn_passes
          where until_at > now() and until_at <= now() + interval '1 day'
        `;
  const copy = subCopy("vpn", window);
  for (const row of rows) {
    const ends = new Date(row.until_at);
    if (Number.isNaN(ends.getTime())) continue;
    if (!(await claimOnce(row.user_id, subKind("vpn", window), subRef(ends)))) continue;
    await sendPush(row.user_id, "subs", { id: copy.id, title: copy.title, body: copy.body, url: copy.url });
  }
}

export async function pushDiskLevel(userId: string) {
  const { quotaOf } = await import("@/lib/social/disk");
  const { used, quota } = await quotaOf(userId);
  if (quota <= 0) return;
  const pct = Math.round((used / quota) * 100);
  const level = pct >= 100 ? "100" : pct >= 80 ? "80" : "";
  if (!level) return;
  if (!(await claimOnce(userId, "disk_quota", level))) return;
  await sendPush(userId, "subs", {
    id: `disk-quota:${level}`,
    title: "Диск почти заполнен",
    body: level === "100" ? "Место закончилось. Освободите место или расширьте диск в магазине" : "Занято больше 80%. Освободите место или расширьте диск в магазине",
    url: "/c/disk",
  });
}
