import { importPKCS8, SignJWT } from "jose";
import { getSql } from "@/lib/db";
import { auth } from "@/lib/auth/server";
import { senderName } from "@/lib/social/telegram.server";
import { stickerCode } from "@/lib/stickers";
import {
  clipText,
  inQuietHours,
  plainText,
  publicNotifyIcon,
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
    select messages, ai, subs, money, security, system, calendar, preview,
           quiet_from as "quietFrom", quiet_to as "quietTo"
    from push_settings where user_id = ${userId}
  `;
  return settingsFrom(rows[0] ?? PUSH_DEFAULTS);
}

export async function savePushSettings(userId: string, next: PushSettings) {
  const sql = await getSql();
  const saved = settingsFrom(next);
  await sql`
    insert into push_settings (user_id, messages, ai, subs, money, security, system, calendar, preview, quiet_from, quiet_to)
    values (
      ${userId}, ${saved.messages}, ${saved.ai}, ${saved.subs}, ${saved.money}, true, ${saved.system}, ${saved.calendar}, ${saved.preview},
      ${saved.quietFrom}, ${saved.quietTo}
    )
    on conflict (user_id) do update
      set messages = ${saved.messages},
          ai = ${saved.ai},
          subs = ${saved.subs},
          money = ${saved.money},
          security = true,
          system = ${saved.system},
          calendar = ${saved.calendar},
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
  payload: {
    id: string;
    title: string;
    body: string;
    url: string;
    preview?: string;
    model?: string;
    chat?: string;
    ts?: string | number;
    icon?: string;
    group?: string;
    kind?: string;
    actions?: { title: string; url: string }[];
  },
  options?: { ignoreQuiet?: boolean },
) {
  if (!validPushPath(payload.url)) return;
  const settings = await getPushSettings(userId);
  if (kind !== "security" && !settings[kind]) return;
  if (kind !== "security" && !options?.ignoreQuiet && inQuietHours(settings)) return;
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
  const data: Record<string, string> = {
    id: clipText(payload.id, 120),
    channel: kind,
    title: clipText(payload.title, 120) || "vvvion",
    body: clipText(payload.body, 600),
    url: payload.url,
  };
  const preview = payload.preview ? clipText(payload.preview, 600) : "";
  const model = payload.model ? clipText(payload.model, 60) : "";
  const chat = payload.chat ? clipText(payload.chat, 80) : "";
  const icon = payload.icon ? publicNotifyIcon(payload.icon) : undefined;
  const note = payload.kind ? clipText(payload.kind, 20) : "";
  const group = payload.group ? clipText(payload.group, 80) : "";
  if (preview) data.preview = preview;
  if (model) data.model = model;
  if (chat) data.chat = chat;
  if (payload.ts != null && Number.isFinite(Number(payload.ts))) data.ts = String(Math.floor(Number(payload.ts)));
  if (icon) data.icon = icon;
  if (note) data.kind = note;
  if (group) data.group = group;
  const actions = payload.actions
    ?.slice(0, 2)
    .flatMap((item) => {
      const title = clipText(item.title, 24);
      return title && validPushPath(item.url) ? [{ title, url: item.url }] : [];
    });
  if (actions?.length) data.actions = JSON.stringify(actions);
  const packed = new TextEncoder().encode(JSON.stringify(data)).byteLength;
  if (packed > 3800 && data.preview) {
    data.preview = data.preview.slice(0, 180);
    if (new TextEncoder().encode(JSON.stringify(data)).byteLength > 3800) delete data.preview;
  }
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
  const room = await sql<{ title: string | null; kind: string }>`select title, kind from rooms where id = ${roomId} limit 1`;
  const face = await sql<{ image: string | null }>`select image from "user" where id = ${fromUserId} limit 1`;
  const chat = room[0]?.kind === "group" ? clipText(room[0]?.title || "", 80) : "";
  const icon = publicNotifyIcon(face[0]?.image);
  await Promise.all(
    members.map(async (member) => {
      const settings = await getPushSettings(member.user_id);
      if (!settings.messages) return;
      if (await seenRecently(member.user_id)) return;
      if (!(await claimDialog(member.user_id, roomId))) return;
      await sendPush(member.user_id, "messages", {
        id: `msg:${roomId}`,
        kind: "message",
        title: name,
        body: settings.preview ? text : "Новое сообщение",
        chat: chat || undefined,
        preview: settings.preview ? text : undefined,
        ts: Date.now(),
        icon,
        url: `/messages/${roomId}`,
      });
    }),
  );
}

export async function pushAiReady(
  userId: string,
  chatId: string,
  messageId: string,
  clientGone: boolean,
  extra?: { model?: string; preview?: string },
) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(chatId) || !/^[A-Za-z0-9_-]{8,80}$/.test(messageId)) return;
  if (!clientGone && (await seenRecently(userId))) return;
  const sql = await getSql();
  const rows = await sql<{ title: string | null }>`
    select title from saved_chats where id = ${chatId} and user_id = ${userId} limit 1
  `;
  const title = clipText(rows[0]?.title || "", 80) || "Чат с ИИ";
  const settings = await getPushSettings(userId);
  const preview = settings.preview ? clipText(plainText(extra?.preview || ""), 600) : "";
  const model = clipText(extra?.model || "", 60);
  await sendPush(userId, "ai", {
    id: `ai:${chatId}:${messageId}`,
    kind: "ai_ready",
    title,
    model: model || undefined,
    chat: title,
    body: "Ответ готов",
    preview: preview || undefined,
    ts: Date.now(),
    url: `/?chat=${chatId}`,
  });
}

export async function pushAiFail(userId: string, chatId: string, messageId: string, clientGone: boolean) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(chatId) || !/^[A-Za-z0-9_-]{8,80}$/.test(messageId)) return;
  if (!clientGone && (await seenRecently(userId))) return;
  await sendPush(userId, "ai", {
    id: `ai-fail:${chatId}:${messageId}`,
    kind: "ai_fail",
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
  await remindVpn("7d");
  await remindVpn("3d");
  await remindVpn("1d");
  await remindVpnExpired();
  await remindVpnTraffic();
  await remindVpnDownNodes();
  const { renewDueVpn, cleanupVpnHistory } = await import("@/lib/social/vpn");
  await renewDueVpn();
  await cleanupVpnHistory();
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

async function remindVpn(window: "7d" | "3d" | "1d") {
  const sql = await getSql();
  const rows =
    window === "7d"
      ? await sql<{ user_id: string; until_at: string }>`
          select user_id, until_at::text as until_at from vpn_passes
          where blocked_at is null and until_at > now() + interval '6 days' and until_at <= now() + interval '7 days'
        `
      : window === "3d"
      ? await sql<{ user_id: string; until_at: string }>`
          select user_id, until_at::text as until_at from vpn_passes
          where blocked_at is null and until_at > now() + interval '2 days' and until_at <= now() + interval '3 days'
        `
      : await sql<{ user_id: string; until_at: string }>`
          select user_id, until_at::text as until_at from vpn_passes
          where blocked_at is null and until_at > now() and until_at <= now() + interval '1 day'
        `;
  const copy =
    window === "7d"
      ? { id: "sub:vpn:7d", title: "Connect", body: "Connect закончится через 7 дней", url: "/c/services" }
      : subCopy("vpn", window);
  for (const row of rows) {
    const ends = new Date(row.until_at);
    if (Number.isNaN(ends.getTime())) continue;
    if (!(await claimOnce(row.user_id, window === "7d" ? "vpn:7d" : subKind("vpn", window), subRef(ends)))) continue;
    await sendPush(row.user_id, "subs", { id: copy.id, title: copy.title, body: copy.body, url: copy.url });
  }
}

async function remindVpnExpired() {
  const sql = await getSql();
  const rows = await sql<{ user_id: string; until_at: string }>`
    select user_id, until_at::text as until_at from vpn_passes
    where until_at > now() - interval '1 day' and until_at <= now()
  `;
  for (const row of rows) {
    const ends = new Date(row.until_at);
    if (Number.isNaN(ends.getTime())) continue;
    if (!(await claimOnce(row.user_id, "vpn:expired", subRef(ends)))) continue;
    await sendPush(row.user_id, "subs", { id: "sub:vpn:expired", title: "Connect", body: "Подписка Connect закончилась", url: "/c/services" });
  }
}

export async function pushVpnNodeDown(nodeId: string, name: string) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(nodeId)) return;
  const sql = await getSql();
  const day = new Date().toISOString().slice(0, 10);
  const people = await sql<{ user_id: string }>`
    select user_id from vpn_passes where blocked_at is null and until_at > now() limit 200
  `;
  const body = `Сервер «${clipText(name, 32) || "Connect"}» сейчас не отвечает`;
  for (const person of people) {
    if (!(await claimOnce(person.user_id, "vpn:down", `${nodeId}:${day}`))) continue;
    await sendPush(person.user_id, "subs", { id: `vpn-down:${nodeId}`, title: "Connect", body, url: "/c/services" });
  }
}

async function remindVpnDownNodes() {
  const sql = await getSql();
  const nodes = await sql<{ id: string; name: string }>`
    select id, name from vpn_nodes where reach = 'down' and enabled = true and maintenance = false
  `;
  for (const node of nodes) await pushVpnNodeDown(node.id, node.name);
}

async function remindVpnTraffic() {
  const sql = await getSql();
  const plan = await sql<{ traffic_bytes: string | number }>`select traffic_bytes from vpn_plan where id = 1`;
  const quota = Number(plan[0]?.traffic_bytes ?? 0);
  if (!(quota > 0)) return;
  const rows = await sql<{ user_id: string; used: string | number; anchor: string; quota:string|number }>`
    select p.user_id, case when p.plan_id='base' or coalesce(pl.traffic_bytes,0)<=0 then ${quota}::bigint else pl.traffic_bytes end as quota,
           coalesce(sum(greatest(c.upload_bytes - c.baseline_upload, 0) + greatest(c.download_bytes - c.baseline_download, 0)), 0)::bigint as used,
           coalesce(to_char(p.quota_reset_at at time zone 'utc', 'YYYY-MM-DD'), 'open') as anchor
    from vpn_passes p
    join vpn_counters c on c.user_id = p.user_id
    left join vpn_plans pl on pl.id=p.plan_id
    where p.blocked_at is null and p.until_at > now()
    group by p.user_id, p.quota_reset_at, p.plan_id, pl.traffic_bytes
  `;
  for (const row of rows) {
    const used = Number(row.used);
    if (!Number.isFinite(used)) continue;
    const actualQuota=Number(row.quota);
    const level = actualQuota>0 && used / actualQuota >= 0.95 ? "95" : actualQuota>0 && used / actualQuota >= 0.8 ? "80" : "";
    if (!level) continue;
    if (!(await claimOnce(row.user_id, `vpn:traffic${level}`, row.anchor || "open"))) continue;
    await sendPush(row.user_id, "subs", {
      id: `vpn-traffic:${level}`,
      title: "Connect",
      body: level === "95" ? "Трафик Connect почти закончился" : "Использовано больше 80% трафика Connect",
      url: "/c/services",
    });
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

export async function pushVpnRenewal(userId:string,day:string,success:boolean,days:number,price:number){
  if(!(await claimOnce(userId,"vpn:auto-renew",day))) return;
  await sendPush(userId,"subs",{id:`vpn-renew:${day}`,title:"Connect",body:success?`Connect продлён на ${days} дней, списано ${price} вублей`:"Не хватило вублей для продления Connect, пополните баланс",url:"/c/services"});
}
