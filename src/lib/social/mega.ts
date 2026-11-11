import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertActive, assertAdmin } from "@/lib/social/access";
import { isUniqueViolation } from "@/lib/social/sql-error";
import { priceOf } from "@/lib/social/prices";
import {
  agentPortOk,
  diskNameOk,
  entryName,
  hostOk,
  MEGA_CHUNK,
  MEGA_DAYS,
  MEGA_PRICE,
  MEGA_QUOTA,
  sshPortOk,
  sshUserOk,
} from "@/lib/social/mega-plan";
import { isMusicFile } from "@/lib/music/tags";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MegaOffer = {
  active: boolean;
  until: string | null;
  price: number;
  days: number;
  verified: boolean;
  quota: number;
  used: number;
};

export type MegaEntry = {
  id: string;
  name: string;
  kind: "file" | "folder";
  bytes: number;
  mime: string;
  createdAt: string;
};

export type MegaView = MegaOffer & {
  ready: boolean;
  diskName: string;
  folderId: string | null;
  crumbs: { id: string; name: string }[];
  entries: MegaEntry[];
};

export type MegaNodePublic = {
  id: string;
  name: string;
  host: string;
  sshPort: number;
  sshUser: string;
  diskName: string;
  agentPort: number;
  status: "new" | "ready" | "error";
  detail: string;
  used: number;
  subscribers: number;
};

type NodeLink = {
  id: string;
  host: string;
  port: number;
  token: string;
  diskName: string;
  status: string;
};

function serverCrypto(): typeof import("node:crypto") {
  const builtin = process.getBuiltinModule?.("node:crypto");
  if (builtin) return builtin;
  const load = new Function("return typeof require === 'function' ? require : null") as () =>
    | ((id: string) => typeof import("node:crypto"))
    | null;
  const req = load();
  if (!req) throw new Error("Шифрование доступно только на сервере");
  return req("node:crypto");
}

function sealKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET?.trim() || "vvvion-mega-local";
  return serverCrypto().createHash("sha256").update(secret).digest();
}

function seal(plain: string): string {
  const { createCipheriv, randomBytes } = serverCrypto();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64");
}

function openSeal(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = serverCrypto().createDecipheriv("aes-256-gcm", sealKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function megaKey(userId: string): string {
  return serverCrypto().createHash("sha256").update(userId).digest("hex").slice(0, 32);
}

function mimeOf(value: string): string {
  const mime = value.toLowerCase().split(";")[0]?.trim() ?? "";
  if (!mime || mime.length > 120 || /[^\w.+/-]/.test(mime)) return "application/octet-stream";
  return mime;
}

function asStatus(value: string): MegaNodePublic["status"] {
  return value === "ready" || value === "new" ? value : "error";
}

async function verified(userId: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ ok: boolean | null }>`select "emailVerified" as ok from "user" where id = ${userId}`;
  return Boolean(rows[0]?.ok);
}

async function ensureNode(userId: string): Promise<void> {
  const sql = await getSql();
  await sql`
    update mega_grants g
    set node_id = (
      select n.id from mega_nodes n
      where n.status = 'ready'
      order by n.used_bytes asc, n.created_at asc
      limit 1
    )
    where g.user_id = ${userId}
      and g.node_id is null
      and exists (select 1 from mega_nodes where status = 'ready')
  `;
}

async function linkOf(userId: string): Promise<NodeLink | null> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    host: string;
    agent_port: number;
    agent_token: string;
    disk_name: string;
    status: string;
  }>`
    select n.id, n.host, n.agent_port, n.agent_token, n.disk_name, n.status
    from mega_grants g
    join mega_nodes n on n.id = g.node_id
    where g.user_id = ${userId}
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  let token = "";
  try {
    token = openSeal(row.agent_token);
  } catch {
    token = "";
  }
  return {
    id: row.id,
    host: row.host,
    port: Number(row.agent_port),
    token,
    diskName: row.disk_name,
    status: row.status,
  };
}

async function offerOf(userId: string): Promise<MegaOffer & { ready: boolean; diskName: string }> {
  const sql = await getSql();
  const rows = await sql<{ until_at: string | null }>`
    select until_at::text as until_at from mega_grants where user_id = ${userId}
  `;
  const until = rows[0]?.until_at ?? null;
  const active = until ? new Date(until).getTime() > Date.now() : false;
  const usedRows = await sql<{ n: number | string }>`
    select coalesce(sum(bytes), 0)::float8 as n
    from mega_entries
    where user_id = ${userId} and kind = 'file' and status = 'ok'
  `;
  const link = await linkOf(userId);
  return {
    active,
    until,
    price: await priceOf("mega", MEGA_PRICE),
    days: MEGA_DAYS,
    verified: await verified(userId),
    quota: MEGA_QUOTA,
    used: Number(usedRows[0]?.n ?? 0),
    ready: link?.status === "ready" && Boolean(link.token),
    diskName: link?.diskName ?? "",
  };
}

async function parentKey(userId: string, folder: string | null): Promise<string> {
  if (!folder) return "";
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    select id from mega_entries
    where id = ${folder} and user_id = ${userId} and kind = 'folder' and status = 'ok'
  `;
  if (!rows[0]) throw new Error("Папка не найдена");
  return folder;
}

async function sweepExpired(): Promise<void> {
  const sql = await getSql();
  let rows: { id: string; user_id: string }[] = [];
  try {
    rows = await sql<{ id: string; user_id: string }>`
      select id, user_id from mega_entries
      where kind = 'file' and expires_at is not null and expires_at <= now()
      limit 24
    `;
  } catch {
    return;
  }
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const list = grouped.get(row.user_id) ?? [];
    list.push(row.id);
    grouped.set(row.user_id, list);
  }
  for (const [userId, ids] of grouped) {
    const link = await linkOf(userId);
    if (link?.status === "ready") {
      try {
        await dropRemote(link, userId, ids);
      } catch {
        /* the row still leaves the list */
      }
    }
    for (const id of ids) {
      await sql`delete from mega_entries where id = ${id} and user_id = ${userId}`;
    }
    if (link) {
      try {
        await refreshUsed(link);
      } catch {
        /* quota catches up on the next visit */
      }
    }
  }
}

async function readView(userId: string, folder: string | null): Promise<MegaView> {
  await sweepExpired();
  await ensureNode(userId);
  const sql = await getSql();
  await sql`
    delete from mega_entries
    where user_id = ${userId} and status = 'up' and created_at < now() - interval '6 hours'
  `;
  const key = await parentKey(userId, folder);
  const offer = await offerOf(userId);
  const crumbs = folder
    ? await sql<{ id: string; name: string }>`
        with recursive up as (
          select id, parent_id, name, 0 as depth
          from mega_entries
          where id = ${folder} and user_id = ${userId} and kind = 'folder'
          union all
          select e.id, e.parent_id, e.name, up.depth + 1
          from mega_entries e
          join up on e.id = up.parent_id
          where up.depth < 24
        )
        select id, name from up order by depth desc
      `
    : [];
  const entries = await sql<{ id: string; name: string; kind: string; bytes: number | string; mime: string; created_at: string }>`
    select id, name, kind, bytes, mime, created_at::text as created_at
    from mega_entries
    where user_id = ${userId} and coalesce(parent_id, '') = ${key} and status = 'ok'
      and (expires_at is null or expires_at > now())
    order by kind desc, lower(name)
  `;
  return {
    ...offer,
    folderId: folder,
    crumbs,
    entries: entries
      .filter((row) => row.kind === "file" || row.kind === "folder")
      .map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind as "file" | "folder",
        bytes: Number(row.bytes) || 0,
        mime: row.mime,
        createdAt: row.created_at,
      })),
  };
}

function folderOf(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const raw = (input as { folder?: unknown }).folder;
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string" || !UUID.test(raw)) throw new Error("Папка не найдена");
  return raw;
}

export const getMegaOffer = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<MegaOffer> => {
    await assertActive(context.userId);
    const view = await offerOf(context.userId);
    return {
      active: view.active,
      until: view.until,
      price: view.price,
      days: view.days,
      verified: view.verified,
      quota: view.quota,
      used: view.used,
    };
  });

export const getMega = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(folderOf)
  .handler(async ({ context, data }): Promise<MegaView> => {
    await assertActive(context.userId);
    return readView(context.userId, data);
  });

export async function purchaseMega(userId: string, idem?: string): Promise<MegaOffer> {
  if (!(await verified(userId))) throw new Error("Сначала подтвердите почту в профиле");
  const price = await priceOf("mega", MEGA_PRICE);
  const sql = await getSql();
  await sql`
    insert into wallets (user_id, balance, last_grant_at)
    values (${userId}, 1000, now())
    on conflict (user_id) do nothing
  `;
  const id = idem ? `mega-${idem}` : `mega-${crypto.randomUUID()}`;
  if (idem) {
    const prev = await sql<{ id: string }>`select id from wallet_transfers where id = ${id}`;
    if (prev.length) return offerOf(userId);
  }
  let done: { id: string }[];
  try {
    done = await sql<{ id: string }>`
      with debit as (
        update wallets
        set balance = balance - ${price}
        where user_id = ${userId} and balance >= ${price}
        returning user_id
      ),
      opened as (
        insert into mega_grants (user_id, until_at, updated_at)
        select user_id, now() + interval '30 days', now()
        from debit
        on conflict (user_id) do update
          set until_at = greatest(mega_grants.until_at, now()) + interval '30 days',
              updated_at = now()
        returning user_id
      )
      insert into wallet_transfers (id, from_id, to_id, amount, note)
      select ${id}, ${userId}, null, ${price}, 'Мегадиск'
      where exists (select 1 from opened)
      returning id
    `;
  } catch (err) {
    if (idem && isUniqueViolation(err)) return offerOf(userId);
    throw err;
  }
  if (!done.length) throw new Error(`Нужно ${price} вублей`);
  await ensureNode(userId);
  void import("@/lib/social/push.server")
    .then((mod) =>
      mod.pushNotice(userId, "money", {
        id: `shop:${id}`,
        title: "Покупка оформлена",
        body: "Мегадиск на 30 дней",
        url: "/c/shop",
      }),
    )
    .catch(() => undefined);
  return offerOf(userId);
}

export const buyMega = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<MegaOffer> => {
    await assertActive(context.userId);
    return purchaseMega(context.userId);
  });

export const makeMegaFolder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const folder = folderOf(input);
    const raw = input && typeof input === "object" ? (input as { name?: unknown }).name : "";
    return { folder, name: entryName(typeof raw === "string" ? raw : "") };
  })
  .handler(async ({ context, data }): Promise<MegaView> => {
    await assertActive(context.userId);
    const offer = await offerOf(context.userId);
    if (!offer.active) throw new Error("Подписка на мегадиск не действует");
    const key = await parentKey(context.userId, data.folder);
    const sql = await getSql();
    const id = crypto.randomUUID();
    try {
      await sql`
        insert into mega_entries (id, user_id, parent_id, name, kind, status)
        values (${id}, ${context.userId}, ${key || null}, ${data.name}, 'folder', 'ok')
      `;
    } catch (error) {
      const text = error instanceof Error ? error.message : "";
      if (/unique|duplicate|mega_entries_slot/i.test(text)) throw new Error("Такое имя уже есть");
      throw new Error("Папка не создалась");
    }
    return readView(context.userId, data.folder);
  });

async function filesUnder(userId: string, id: string): Promise<string[]> {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    with recursive tree as (
      select id, kind from mega_entries where id = ${id} and user_id = ${userId}
      union all
      select e.id, e.kind from mega_entries e join tree t on e.parent_id = t.id
    )
    select id from tree where kind = 'file'
  `;
  return rows.map((row) => row.id);
}

async function pause(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function callAgent(link: NodeLink, method: string, path: string, body?: Uint8Array | ReadableStream<Uint8Array>, extra?: Record<string, string>, length?: number, timeoutMs?: number, idleMs?: number): Promise<Response> {
  if (!link.token || !hostOk(link.host) || !agentPortOk(link.port)) throw new Error("Диск сейчас не отвечает");
  const streaming = method === "GET" && path.startsWith("/blob/");
  const tries = streaming ? 1 : 2;
  let last = "Диск не ответил";
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const ctrl = new AbortController();
    const budget = timeoutMs ?? (streaming ? 15 * 60_000 : 18_000);
    const total = setTimeout(() => ctrl.abort(), budget);
    let idle: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(total);
      if (idle) clearTimeout(idle);
    };
    ctrl.signal.addEventListener("abort", stop, { once: true });
    const bump = () => {
      if (!streaming) return;
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => ctrl.abort(), idleMs ?? 45_000);
    };
    bump();
    try {
      const headers = new Headers({ Authorization: `Bearer ${link.token}`, ...extra });
      const streamed = Boolean(body) && !(body instanceof Uint8Array);
      if (body) headers.set("content-length", String(body instanceof Uint8Array ? body.byteLength : length || 0));
      const res = await fetch(`http://${link.host}:${link.port}${path}`, {
        method,
        headers,
        body: body instanceof Uint8Array ? Buffer.from(body) : body,
        signal: ctrl.signal,
        ...(streamed ? { duplex: "half" as const } : {}),
      });
      if (!streaming && !res.ok) {
        const snippet = await res.clone().text().catch(() => "");
        console.error("[mega]", method, res.status, path, snippet.replace(/\s+/g, " ").slice(0, 180));
      }
      if (!streaming || !res.body) {
        stop();
        return res;
      }
      const reader = res.body.getReader();
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const step = await reader.read();
            bump();
            if (step.done) {
              stop();
              controller.close();
              return;
            }
            controller.enqueue(step.value);
          } catch (error) {
            stop();
            controller.error(error);
          }
        },
        cancel(reason) {
          stop();
          void reader.cancel(reason);
        },
      });
      return new Response(stream, { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch (error) {
      stop();
      const name = error instanceof Error ? error.name : "error";
      console.error("[mega]", method, name, path);
      last = "Диск не ответил";
      if (attempt + 1 >= tries) break;
      await pause(350 * (attempt + 1));
    }
  }
  throw new Error(last);
}

async function refreshUsed(link: NodeLink): Promise<void> {
  const sql = await getSql();
  try {
    const res = await callAgent(link, "GET", "/health");
    const body = (await res.json()) as { used?: number };
    if (res.ok && Number.isFinite(Number(body.used))) {
      await sql`update mega_nodes set used_bytes = ${Number(body.used)} where id = ${link.id}`;
      return;
    }
  } catch {
    /* fall through to the ledger */
  }
  await sql`
    update mega_nodes n
    set used_bytes = (
      select coalesce(sum(e.bytes), 0)
      from mega_entries e
      join mega_grants g on g.user_id = e.user_id
      where g.node_id = n.id and e.kind = 'file' and e.status = 'ok'
    )
    where n.id = ${link.id}
  `;
}

async function dropRemote(link: NodeLink, userId: string, ids: string[]): Promise<void> {
  const key = megaKey(userId);
  for (const id of ids) {
    const res = await callAgent(link, "DELETE", `/blob/${key}/${id}`);
    if (!res.ok && res.status !== 404) throw new Error("Файл с диска не ушёл");
  }
}

export const removeMega = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const folder = folderOf(input);
    const raw = input && typeof input === "object" ? (input as { id?: unknown }).id : "";
    if (typeof raw !== "string" || !UUID.test(raw)) throw new Error("Не найдено");
    return { id: raw, folder };
  })
  .handler(async ({ context, data }): Promise<MegaView> => {
    await assertActive(context.userId);
    const link = await linkOf(context.userId);
    if (!link || link.status !== "ready") throw new Error("Диск сейчас не отвечает");
    const ids = await filesUnder(context.userId, data.id);
    if (ids.length) await dropRemote(link, context.userId, ids);
    const sql = await getSql();
    await sql`delete from mega_entries where id = ${data.id} and user_id = ${context.userId}`;
    await refreshUsed(link);
    return readView(context.userId, data.folder);
  });

export const renameMega = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const folder = folderOf(input);
    const raw = input && typeof input === "object" ? (input as { id?: unknown; name?: unknown }) : {};
    if (typeof raw.id !== "string" || !UUID.test(raw.id)) throw new Error("Не найдено");
    return { id: raw.id, folder, name: entryName(typeof raw.name === "string" ? raw.name : "") };
  })
  .handler(async ({ context, data }): Promise<MegaView> => {
    await assertActive(context.userId);
    const sql = await getSql();
    try {
      const rows = await sql<{ id: string }>`
        update mega_entries set name = ${data.name}
        where id = ${data.id} and user_id = ${context.userId} and status = 'ok'
        returning id
      `;
      if (!rows[0]) throw new Error("Не найдено");
    } catch (error) {
      const text = error instanceof Error ? error.message : "";
      if (/уникаль|unique|duplicate|mega_entries_slot/i.test(text)) throw new Error("Такое имя уже есть");
      if (text === "Не найдено") throw error;
      throw new Error("Имя не сменилось");
    }
    return readView(context.userId, data.folder);
  });

export const listMegaFolders = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ id: string; name: string }[]> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const rows = await sql<{ id: string; name: string }>`
      select id, name from mega_entries
      where user_id = ${context.userId} and kind = 'folder' and status = 'ok'
      order by lower(name)
      limit 200
    `;
    return rows;
  });

export const moveMega = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const folder = folderOf(input);
    const raw = input && typeof input === "object" ? (input as { ids?: unknown; dest?: unknown }) : {};
    const ids = Array.isArray(raw.ids) ? raw.ids.filter((id): id is string => typeof id === "string" && UUID.test(id)).slice(0, 80) : [];
    if (!ids.length) throw new Error("Нечего перемещать");
    let dest: string | null = null;
    if (raw.dest != null && raw.dest !== "") {
      if (typeof raw.dest !== "string" || !UUID.test(raw.dest)) throw new Error("Папка не найдена");
      dest = raw.dest;
    }
    return { ids, folder, dest };
  })
  .handler(async ({ context, data }): Promise<MegaView> => {
    await assertActive(context.userId);
    if (data.dest) await parentKey(context.userId, data.dest);
    const sql = await getSql();
    for (const id of data.ids) {
      try {
        await sql`
          update mega_entries set parent_id = ${data.dest}
          where id = ${id} and user_id = ${context.userId} and kind = 'file' and status = 'ok'
        `;
      } catch (error) {
        const text = error instanceof Error ? error.message : "";
        if (/unique|duplicate|mega_entries_slot/i.test(text)) throw new Error("В этой папке уже есть такое имя");
        throw new Error("Не удалось переместить");
      }
    }
    return readView(context.userId, data.folder);
  });

export async function beginMegaUpload(userId: string, name: string, folder: string | null, mime: string, size: number): Promise<string> {
  await assertActive(userId);
  await ensureNode(userId);
  const offer = await offerOf(userId);
  if (!offer.active) throw new Error("Подписка на мегадиск не действует");
  if (!offer.ready) throw new Error("Диск ещё не поставлен");
  if (!Number.isFinite(size) || size < 1 || size > MEGA_QUOTA) throw new Error("Файл пустой или больше 2 ГБ");
  if (offer.used + size > MEGA_QUOTA) throw new Error("На мегадиске не хватает места");
  const clean = entryName(name);
  const key = await parentKey(userId, folder);
  const sql = await getSql();
  const id = crypto.randomUUID();
  const rows = await sql<{ id: string }>`
    insert into mega_entries (id, user_id, parent_id, name, kind, mime, bytes, expect, status)
    select ${id}, ${userId}, ${key || null}, ${clean}, 'file', ${mimeOf(mime)}, 0, ${size}, 'up'
    where not exists (
      select 1 from mega_entries
      where user_id = ${userId} and coalesce(parent_id, '') = ${key} and name = ${clean} and status = 'ok'
    )
    returning id
  `;
  if (!rows[0]) throw new Error("Такое имя уже есть");
  return id;
}

function chunkBudget(bytes: number) {
  return Math.min(120_000, Math.max(25_000, Math.ceil(bytes / 16_384) * 1000));
}

export async function uploadOffset(userId: string, id: string): Promise<number> {
  if (!UUID.test(id)) throw new Error("Файл не найден");
  const sql = await getSql();
  const rows = await sql<{ bytes: number | string }>`
    select bytes from mega_entries
    where id = ${id} and user_id = ${userId} and kind = 'file' and status = 'up'
  `;
  if (!rows[0]) throw new Error("Загрузка прервана");
  return Number(rows[0].bytes) || 0;
}

export async function writeMegaChunk(userId: string, id: string, offset: number, bytes: Uint8Array): Promise<void> {
  if (!UUID.test(id) || !Number.isInteger(offset) || offset < 0 || bytes.length < 1 || bytes.length > MEGA_CHUNK) {
    throw new Error("Кусок файла не принят");
  }
  const link = await linkOf(userId);
  if (!link || link.status !== "ready") throw new Error("Диск сейчас не отвечает");
  const sql = await getSql();
  const rows = await sql<{ bytes: number | string; expect: number | string }>`
    select bytes, expect from mega_entries
    where id = ${id} and user_id = ${userId} and kind = 'file' and status = 'up'
  `;
  const row = rows[0];
  if (!row) throw new Error("Загрузка прервана");
  const have = Number(row.bytes);
  const expect = Number(row.expect);
  if (offset + bytes.length > expect) throw new Error("Кусок не на месте");
  if (offset + bytes.length <= have) return;
  if (offset !== have) throw new Error("Кусок не на месте");
  const res = await callAgent(link, "PUT", `/blob/${megaKey(userId)}/${id}`, bytes, { "X-Offset": String(offset) }, undefined, chunkBudget(bytes.length));
  if (!res.ok) throw new Error("Диск не принял кусок");
  const saved = await sql<{ id: string }>`
    update mega_entries set bytes = ${offset + bytes.length}
    where id = ${id} and user_id = ${userId} and status = 'up' and bytes = ${offset}
    returning id
  `;
  if (saved[0]) return;
  const again = await sql<{ bytes: number | string }>`
    select bytes from mega_entries where id = ${id} and user_id = ${userId} and status = 'up'
  `;
  if (Number(again[0]?.bytes) >= offset + bytes.length) return;
  throw new Error("Кусок не на месте");
}

export async function writeMegaChunkStream(userId: string, id: string, offset: number, stream: ReadableStream<Uint8Array>, length: number): Promise<void> {
  if (!UUID.test(id) || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 1 || length > MEGA_CHUNK) {
    throw new Error("Кусок файла не принят");
  }
  const link = await linkOf(userId);
  if (!link || link.status !== "ready") throw new Error("Диск сейчас не отвечает");
  const sql = await getSql();
  const rows = await sql<{ bytes: number | string; expect: number | string }>`
    select bytes, expect from mega_entries
    where id = ${id} and user_id = ${userId} and kind = 'file' and status = 'up'
  `;
  const row = rows[0];
  if (!row) throw new Error("Загрузка прервана");
  const have = Number(row.bytes);
  const expect = Number(row.expect);
  if (offset + length > expect) throw new Error("Кусок не на месте");
  if (offset + length <= have) return;
  if (offset !== have) throw new Error("Кусок не на месте");
  const res = await callAgent(link, "PUT", `/blob/${megaKey(userId)}/${id}`, stream, { "X-Offset": String(offset) }, length, chunkBudget(length));
  if (!res.ok) throw new Error("Диск не принял кусок");
  const saved = await sql<{ id: string }>`
    update mega_entries set bytes = ${offset + length}
    where id = ${id} and user_id = ${userId} and status = 'up' and bytes = ${offset}
    returning id
  `;
  if (saved[0]) return;
  const again = await sql<{ bytes: number | string }>`
    select bytes from mega_entries where id = ${id} and user_id = ${userId} and status = 'up'
  `;
  if (Number(again[0]?.bytes) >= offset + length) return;
  throw new Error("Кусок не на месте");
}

export async function storeMegaBytes(
  userId: string,
  name: string,
  mime: string,
  bytes: Uint8Array,
  ttlSeconds = 0,
): Promise<{ id: string; name: string }> {
  if (bytes.byteLength < 1) throw new Error("Файл пустой");
  let label = name.trim() || "Файл";
  let id = "";
  try {
    id = await beginMegaUpload(userId, label, null, mime, bytes.byteLength);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/уже есть/i.test(message)) throw error;
    const dot = label.lastIndexOf(".");
    const ext = dot > 0 && label.length - dot <= 8 ? label.slice(dot) : "";
    const stem = (ext ? label.slice(0, label.length - ext.length) : label).trim().slice(0, 60) || "Файл";
    label = `${stem} ${Math.random().toString(36).slice(2, 6)}${ext}`.trim().slice(0, 80);
    id = await beginMegaUpload(userId, label, null, mime, bytes.byteLength);
  }
  try {
    let offset = 0;
    while (offset < bytes.byteLength) {
      const next = bytes.subarray(offset, Math.min(bytes.byteLength, offset + MEGA_CHUNK));
      await writeMegaChunk(userId, id, offset, next);
      offset += next.byteLength;
    }
    await finishMegaUpload(userId, id);
    if (ttlSeconds > 0) {
      const sql = await getSql();
      await sql`
        update mega_entries
        set expires_at = now() + (${Math.round(ttlSeconds)} * interval '1 second')
        where id = ${id} and user_id = ${userId}
      `;
    }
  } catch (error) {
    await cancelMegaUpload(userId, id).catch(() => undefined);
    throw error;
  }
  return { id, name: label };
}

export async function finishMegaUpload(userId: string, id: string): Promise<void> {
  if (!UUID.test(id)) throw new Error("Файл не найден");
  const link = await linkOf(userId);
  if (!link || link.status !== "ready") throw new Error("Диск сейчас не отвечает");
  const sql = await getSql();
  const rows = await sql<{ bytes: number | string; expect: number | string }>`
    select bytes, expect from mega_entries where id = ${id} and user_id = ${userId} and status = 'up'
  `;
  const row = rows[0];
  if (!row || Number(row.bytes) !== Number(row.expect)) throw new Error("Файл ещё не доехал");
  let head: Response | null = null;
  let size = 0;
  const expect = Number(row.expect);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    head = await callAgent(link, "HEAD", `/blob/${megaKey(userId)}/${id}`);
    size = Number(head.headers.get("content-length") || head.headers.get("x-size") || 0);
    if (head.ok && size === expect) break;
    console.error("[mega] finish", head.status, size, expect);
    if (attempt < 2) await pause(400);
  }
  if (!head?.ok || size !== expect) throw new Error("Диск не подтвердил файл");
  await sql`update mega_entries set status = 'ok' where id = ${id} and user_id = ${userId} and status = 'up'`;
  await refreshUsed(link);
}

export async function cancelMegaUpload(userId: string, id: string): Promise<void> {
  if (!UUID.test(id)) return;
  const sql = await getSql();
  const rows = await sql<{ status: string }>`
    select status from mega_entries where id = ${id} and user_id = ${userId}
  `;
  if (rows[0]?.status !== "up") return;
  const link = await linkOf(userId);
  if (link?.status === "ready") {
    try {
      await dropRemote(link, userId, [id]);
    } catch {
      /* the row still goes */
    }
  }
  await sql`delete from mega_entries where id = ${id} and user_id = ${userId} and status = 'up'`;
}

async function fileMeta(userId: string, id: string): Promise<{ name: string; mime: string; size: number; link: NodeLink }> {
  await assertActive(userId);
  if (!UUID.test(id)) throw new Error("Файл не найден");
  const sql = await getSql();
  const rows = await sql<{ name: string; mime: string; bytes: number | string; expires_at: string | null }>`
    select name, mime, bytes, expires_at::text as expires_at from mega_entries
    where id = ${id} and user_id = ${userId} and kind = 'file' and status = 'ok'
  `;
  const row = rows[0];
  if (!row) throw new Error("Файл не найден");
  const link = await linkOf(userId);
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    if (link?.status === "ready") {
      try {
        await dropRemote(link, userId, [id]);
      } catch {
        /* the row still goes */
      }
    }
    await sql`delete from mega_entries where id = ${id} and user_id = ${userId}`;
    throw new Error("Файл не найден");
  }
  if (!link || link.status !== "ready") throw new Error("Диск сейчас не отвечает");
  return { name: row.name, mime: row.mime || "application/octet-stream", size: Number(row.bytes) || 0, link };
}

export async function readMegaDownload(
  userId: string,
  id: string,
  range?: { start: number; end: number } | null,
): Promise<{ name: string; mime: string; size: number; response: Response }> {
  const meta = await fileMeta(userId, id);
  const extra: Record<string, string> = {};
  if (range) {
    extra["X-Start"] = String(range.start);
    extra["X-End"] = String(range.end);
  }
  const upstream = await callAgent(meta.link, "GET", `/blob/${megaKey(userId)}/${id}`, undefined, Object.keys(extra).length ? extra : undefined);
  if (upstream.status === 416) return { name: meta.name, mime: meta.mime, size: meta.size, response: upstream };
  if (!upstream.ok || !upstream.body) throw new Error("Файл не открылся");
  return { name: meta.name, mime: meta.mime, size: meta.size, response: upstream };
}

export async function peekMegaFile(userId: string, id: string): Promise<{ name: string; mime: string; size: number }> {
  const meta = await fileMeta(userId, id);
  return { name: meta.name, mime: meta.mime, size: meta.size };
}

export async function stampMegaHead(userId: string, id: string, bytes: Uint8Array): Promise<void> {
  if (!UUID.test(id) || bytes.length < 10 || bytes.length > MEGA_CHUNK) throw new Error("Теги не влезли");
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) throw new Error("Теги не влезли");
  const size = ((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f);
  if (size + 10 !== bytes.length) throw new Error("Теги не влезли");
  const meta = await fileMeta(userId, id);
  if (!isMusicFile(meta.name, meta.mime)) throw new Error("Это не музыка");
  const head = await callAgent(meta.link, "HEAD", `/blob/${megaKey(userId)}/${id}`);
  const remote = Number(head.headers.get("content-length") || 0);
  if (!head.ok || remote < bytes.length) throw new Error("Файл не открылся");
  const res = await callAgent(meta.link, "PUT", `/blob/${megaKey(userId)}/${id}`, bytes, { "X-Offset": "0" });
  if (!res.ok) throw new Error("Диск не принял теги");
}

async function shareMeta(viewerId: string, id: string): Promise<{ name: string; mime: string; size: number; ownerId: string; link: NodeLink }> {
  await assertActive(viewerId);
  if (!UUID.test(id)) throw new Error("Файл не найден");
  const sql = await getSql();
  const rows = await sql<{ name: string; mime: string; bytes: number | string; user_id: string }>`
    select name, mime, bytes, user_id from mega_entries
    where id = ${id} and kind = 'file' and status = 'ok'
    limit 1
  `;
  const row = rows[0];
  if (!row) throw new Error("Файл не найден");
  if (row.user_id !== viewerId) {
    const mark = `⟦mega:${id}⟧`;
    const allowed = await sql<{ ok: number }>`
      select 1 as ok
      from room_messages m
      join room_members me on me.room_id = m.room_id and me.user_id = ${viewerId}
      where m.user_id = ${row.user_id} and strpos(m.body, ${mark}) > 0
      union all
      select 1
      from posts p
      where p.user_id = ${row.user_id} and strpos(p.body, ${mark}) > 0
      limit 1
    `;
    if (!allowed[0]) throw new Error("Файл не найден");
  }
  const link = await linkOf(row.user_id);
  if (!link || link.status !== "ready" || !link.token) throw new Error("Диск сейчас не отвечает");
  return {
    name: row.name,
    mime: row.mime || "application/octet-stream",
    size: Number(row.bytes) || 0,
    ownerId: row.user_id,
    link,
  };
}

export async function peekMegaShare(userId: string, id: string): Promise<{ name: string; mime: string; size: number }> {
  const meta = await shareMeta(userId, id);
  return { name: meta.name, mime: meta.mime, size: meta.size };
}

export async function readMegaShare(
  userId: string,
  id: string,
  range?: { start: number; end: number } | null,
): Promise<{ name: string; mime: string; size: number; response: Response }> {
  const meta = await shareMeta(userId, id);
  const extra: Record<string, string> = {};
  if (range) {
    extra["X-Start"] = String(range.start);
    extra["X-End"] = String(range.end);
  }
  const upstream = await callAgent(meta.link, "GET", `/blob/${megaKey(meta.ownerId)}/${id}`, undefined, Object.keys(extra).length ? extra : undefined);
  if (upstream.status === 416) return { name: meta.name, mime: meta.mime, size: meta.size, response: upstream };
  if (!upstream.ok || !upstream.body) throw new Error("Файл не открылся");
  return { name: meta.name, mime: meta.mime, size: meta.size, response: upstream };
}

export const listMegaFiles = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ id: string; name: string; mime: string; bytes: number }[]> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const rows = await sql<{ id: string; name: string; mime: string; bytes: number | string }>`
      select id, name, mime, bytes from mega_entries
      where user_id = ${context.userId} and kind = 'file' and status = 'ok'
      order by created_at desc
      limit 80
    `;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      mime: row.mime || "application/octet-stream",
      bytes: Number(row.bytes) || 0,
    }));
  });

export const readMegaCard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = typeof input === "string" ? input.trim() : "";
    if (!UUID.test(id)) throw new Error("Файл не найден");
    return id;
  })
  .handler(async ({ context, data }): Promise<{ name: string; mime: string; bytes: number }> => {
    const meta = await shareMeta(context.userId, data);
    return { name: meta.name, mime: meta.mime, bytes: meta.size };
  });

const SHARE_TOKEN = /^[A-Za-z0-9_-]{16,32}$/;

export type PublicMegaEntry = {
  id: string;
  name: string;
  kind: "file" | "folder";
  mime: string;
  bytes: number;
};

export type PublicMega = {
  token: string;
  title: string;
  rootId: string;
  folderId: string;
  crumbs: { id: string; name: string }[];
  file: PublicMegaEntry | null;
  entries: PublicMegaEntry[];
};

function freshShareToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function shareId(input: unknown) {
  const id = typeof input === "string" ? input.trim() : "";
  if (!UUID.test(id)) throw new Error("Файл не найден");
  return id;
}

export const peekMegaLink = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(shareId)
  .handler(async ({ context, data }): Promise<string | null> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const rows = await sql<{ token: string }>`
      select token from mega_shares
      where entry_id = ${data} and user_id = ${context.userId}
      limit 1
    `;
    return rows[0]?.token ?? null;
  });

export const shareMega = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(shareId)
  .handler(async ({ context, data }): Promise<{ token: string }> => {
    await assertActive(context.userId);
    const offer = await offerOf(context.userId);
    if (!offer.active) throw new Error("Подписка на мегадиск не действует");
    const sql = await getSql();
    const rows = await sql<{ id: string }>`
      select id from mega_entries
      where id = ${data} and user_id = ${context.userId} and status = 'ok'
        and (expires_at is null or expires_at > now())
    `;
    if (!rows[0]) throw new Error("Файл не найден");
    const had = await sql<{ token: string }>`
      select token from mega_shares where entry_id = ${data} and user_id = ${context.userId} limit 1
    `;
    if (had[0]) return { token: had[0].token };
    const token = freshShareToken();
    try {
      await sql`
        insert into mega_shares (token, user_id, entry_id)
        values (${token}, ${context.userId}, ${data})
      `;
      return { token };
    } catch {
      const again = await sql<{ token: string }>`
        select token from mega_shares where entry_id = ${data} and user_id = ${context.userId} limit 1
      `;
      if (again[0]) return { token: again[0].token };
      throw new Error("Ссылка не создалась");
    }
  });

export const dropMegaShare = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(shareId)
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    await assertActive(context.userId);
    const sql = await getSql();
    await sql`delete from mega_shares where entry_id = ${data} and user_id = ${context.userId}`;
    return { ok: true };
  });

async function shareRoot(token: string): Promise<{ owner: string; root: string; kind: "file" | "folder"; name: string } | null> {
  if (!SHARE_TOKEN.test(token)) return null;
  const sql = await getSql();
  const rows = await sql<{ user_id: string; entry_id: string; kind: string; name: string }>`
    select s.user_id, s.entry_id, e.kind, e.name
    from mega_shares s
    join mega_entries e on e.id = s.entry_id and e.user_id = s.user_id
    where s.token = ${token} and e.status = 'ok'
      and (e.expires_at is null or e.expires_at > now())
    limit 1
  `;
  const row = rows[0];
  if (!row || (row.kind !== "file" && row.kind !== "folder")) return null;
  return { owner: row.user_id, root: row.entry_id, kind: row.kind, name: row.name };
}

async function insideShare(owner: string, root: string, target: string): Promise<boolean> {
  if (!UUID.test(target)) return false;
  if (target === root) return true;
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    with recursive chain as (
      select id, parent_id, 0 as depth from mega_entries
      where id = ${target} and user_id = ${owner} and status = 'ok'
      union all
      select e.id, e.parent_id, c.depth + 1
      from mega_entries e
      join chain c on e.id = c.parent_id
      where e.user_id = ${owner} and c.id <> ${root} and c.depth < 40
    )
    select id from chain where id = ${root} limit 1
  `;
  return Boolean(rows[0]);
}

function publicEntry(row: { id: string; name: string; kind: string; mime: string; bytes: number | string }): PublicMegaEntry {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === "folder" ? "folder" : "file",
    mime: row.mime || "",
    bytes: Number(row.bytes) || 0,
  };
}

export const readPublicMega = createServerFn({ method: "GET" })
  .validator((input: unknown): { token: string; folder: string | null } => {
    const raw = input && typeof input === "object" ? (input as { token?: unknown; folder?: unknown }) : {};
    const token = typeof raw.token === "string" && SHARE_TOKEN.test(raw.token) ? raw.token : "";
    const folder = typeof raw.folder === "string" && UUID.test(raw.folder) ? raw.folder : null;
    return { token, folder };
  })
  .handler(async ({ data }): Promise<PublicMega | null> => {
    const share = await shareRoot(data.token);
    if (!share) return null;
    if (share.kind === "file") {
      const sql = await getSql();
      const rows = await sql<{ id: string; name: string; kind: string; mime: string; bytes: number | string }>`
        select id, name, kind, mime, bytes from mega_entries
        where id = ${share.root} and user_id = ${share.owner} and status = 'ok'
          and (expires_at is null or expires_at > now())
        limit 1
      `;
      const file = rows[0] ? publicEntry(rows[0]) : null;
      if (!file) return null;
      return { token: data.token, title: share.name, rootId: share.root, folderId: share.root, crumbs: [], file, entries: [] };
    }
    const folder = data.folder && (await insideShare(share.owner, share.root, data.folder)) ? data.folder : share.root;
    const sql = await getSql();
    const crumbs = await sql<{ id: string; name: string }>`
      with recursive chain as (
        select id, parent_id, name, 0 as depth from mega_entries
        where id = ${folder} and user_id = ${share.owner} and status = 'ok'
        union all
        select e.id, e.parent_id, e.name, c.depth + 1
        from mega_entries e
        join chain c on e.id = c.parent_id
        where e.user_id = ${share.owner} and c.id <> ${share.root} and c.depth < 40
      )
      select id, name from chain order by depth desc
    `;
    const kids = await sql<{ id: string; name: string; kind: string; mime: string; bytes: number | string }>`
      select id, name, kind, mime, bytes from mega_entries
      where user_id = ${share.owner} and parent_id = ${folder} and status = 'ok'
        and (expires_at is null or expires_at > now())
      order by case when kind = 'folder' then 0 else 1 end, lower(name)
    `;
    const here = crumbs[crumbs.length - 1];
    return {
      token: data.token,
      title: here?.name || share.name,
      rootId: share.root,
      folderId: folder,
      crumbs,
      file: null,
      entries: kids.map(publicEntry),
    };
  });

export async function publicMegaFileMeta(token: string, id: string): Promise<{ name: string; mime: string; size: number } | null> {
  const share = await shareRoot(token);
  if (!share || !UUID.test(id)) return null;
  if (!(await insideShare(share.owner, share.root, id))) return null;
  const sql = await getSql();
  const rows = await sql<{ name: string; mime: string; bytes: number | string; kind: string }>`
    select name, mime, bytes, kind from mega_entries
    where id = ${id} and user_id = ${share.owner} and status = 'ok' and kind = 'file'
      and (expires_at is null or expires_at > now())
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return { name: row.name, mime: row.mime || "application/octet-stream", size: Number(row.bytes) || 0 };
}

export async function publicMegaFileBody(token: string, id: string, range?: { start: number; end: number } | null): Promise<Response> {
  const share = await shareRoot(token);
  if (!share || !(await insideShare(share.owner, share.root, id))) throw new Error("Файл не найден");
  const link = await linkOf(share.owner);
  if (!link || link.status !== "ready" || !link.token) throw new Error("Диск сейчас не отвечает");
  const extra: Record<string, string> = {};
  if (range) {
    extra["X-Start"] = String(range.start);
    extra["X-End"] = String(range.end);
  }
  const upstream = await callAgent(link, "GET", `/blob/${megaKey(share.owner)}/${id}`, undefined, Object.keys(extra).length ? extra : undefined, undefined, 2 * 60 * 60_000, 120_000);
  if (!upstream.ok && upstream.status !== 416) throw new Error("Файл не открылся");
  return upstream;
}

function nodeInput(input: unknown): {
  id: string | null;
  name: string;
  host: string;
  sshPort: number;
  sshUser: string;
  password: string;
  diskName: string;
  agentPort: number;
} {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const id = typeof raw.id === "string" && UUID.test(raw.id) ? raw.id : null;
  if (typeof raw.id === "string" && raw.id && !id) throw new Error("Сервер не найден");
  const name = typeof raw.name === "string" ? raw.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 40) : "";
  const host = typeof raw.host === "string" ? raw.host.trim().toLowerCase() : "";
  const sshUser = typeof raw.sshUser === "string" ? raw.sshUser.trim().toLowerCase() : "root";
  const password = typeof raw.password === "string" ? raw.password : "";
  const diskName = typeof raw.diskName === "string" ? raw.diskName.trim().toLowerCase() : "";
  const sshPort = Number(raw.sshPort ?? 22);
  const agentPort = Number(raw.agentPort ?? 8742);
  if (!name) throw new Error("Нужно название");
  if (!hostOk(host)) throw new Error("Нужен IP или имя сервера");
  if (!sshUserOk(sshUser)) throw new Error("Логин SSH не похож на имя");
  if (!sshPortOk(sshPort)) throw new Error("Порт SSH не подходит. 443 и 8443 не трогаем");
  if ((!id && password.length < 1) || password.length > 200) throw new Error("Нужен пароль");
  if (!diskNameOk(diskName)) throw new Error("Имя диска: латиница, цифры и дефис");
  if (!agentPortOk(agentPort)) throw new Error("Порт диска с 1024, кроме 8443. 443 не занимаем");
  return { id, name, host, sshPort, sshUser, password, diskName, agentPort };
}

async function listNodes(): Promise<MegaNodePublic[]> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    name: string;
    host: string;
    ssh_port: number;
    ssh_user: string;
    disk_name: string;
    agent_port: number;
    status: string;
    detail: string;
    used_bytes: number | string;
    subscribers: number | string;
  }>`
    select n.id, n.name, n.host, n.ssh_port, n.ssh_user, n.disk_name, n.agent_port, n.status, n.detail, n.used_bytes,
           (select count(*) from mega_grants g where g.node_id = n.id) as subscribers
    from mega_nodes n
    order by n.created_at asc
  `;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    host: row.host,
    sshPort: Number(row.ssh_port),
    sshUser: row.ssh_user,
    diskName: row.disk_name,
    agentPort: Number(row.agent_port),
    status: asStatus(row.status),
    detail: row.detail,
    used: Number(row.used_bytes) || 0,
    subscribers: Number(row.subscribers) || 0,
  }));
}

export const listMegaNodes = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    return listNodes();
  });

export const saveMegaNode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(nodeInput)
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    if (data.id) {
      const rows = await sql<{
        host: string;
        ssh_port: number;
        ssh_user: string;
        disk_name: string;
        agent_port: number;
        status: string;
        detail: string;
      }>`
        select host, ssh_port, ssh_user, disk_name, agent_port, status, detail
        from mega_nodes where id = ${data.id}
      `;
      const row = rows[0];
      if (!row) throw new Error("Сервер не найден");
      const same =
        row.host === data.host &&
        Number(row.ssh_port) === data.sshPort &&
        row.ssh_user === data.sshUser &&
        row.disk_name === data.diskName &&
        Number(row.agent_port) === data.agentPort;
      const status = same ? row.status : "new";
      const detail = same ? row.detail : "Данные обновлены. Поставьте снова.";
      try {
        if (data.password) {
          await sql`
            update mega_nodes
            set name = ${data.name}, host = ${data.host}, ssh_port = ${data.sshPort}, ssh_user = ${data.sshUser},
                ssh_secret = ${seal(data.password)}, disk_name = ${data.diskName}, agent_port = ${data.agentPort},
                status = ${status}, detail = ${detail}
            where id = ${data.id}
          `;
        } else {
          await sql`
            update mega_nodes
            set name = ${data.name}, host = ${data.host}, ssh_port = ${data.sshPort}, ssh_user = ${data.sshUser},
                disk_name = ${data.diskName}, agent_port = ${data.agentPort}, status = ${status}, detail = ${detail}
            where id = ${data.id}
          `;
        }
      } catch (error) {
        const text = error instanceof Error ? error.message : "";
        if (text.toLowerCase().includes("unique") || text.includes("mega_nodes_host")) throw new Error("Такой сервер уже есть");
        throw new Error("Сервер не записался");
      }
      return listNodes();
    }
    const id = crypto.randomUUID();
    const token = serverCrypto().randomBytes(24).toString("hex");
    try {
      await sql`
        insert into mega_nodes (id, name, host, ssh_port, ssh_user, ssh_secret, disk_name, agent_port, agent_token, status, detail)
        values (
          ${id}, ${data.name}, ${data.host}, ${data.sshPort}, ${data.sshUser}, ${seal(data.password)},
          ${data.diskName}, ${data.agentPort}, ${seal(token)}, 'new', 'Ещё не поставлен'
        )
      `;
    } catch (error) {
      const text = error instanceof Error ? error.message : "";
      if (text.toLowerCase().includes("unique") || text.includes("mega_nodes_host")) throw new Error("Такой сервер уже есть");
      throw new Error("Сервер не записался");
    }
    return listNodes();
  });

async function secretOf(id: string): Promise<{ host: string; sshPort: number; sshUser: string; password: string; diskName: string; agentPort: number; token: string }> {
  const sql = await getSql();
  const rows = await sql<{
    host: string;
    ssh_port: number;
    ssh_user: string;
    ssh_secret: string;
    disk_name: string;
    agent_port: number;
    agent_token: string;
  }>`
    select host, ssh_port, ssh_user, ssh_secret, disk_name, agent_port, agent_token
    from mega_nodes where id = ${id}
  `;
  const row = rows[0];
  if (!row) throw new Error("Сервер не найден");
  try {
    return {
      host: row.host,
      sshPort: Number(row.ssh_port),
      sshUser: row.ssh_user,
      password: openSeal(row.ssh_secret),
      diskName: row.disk_name,
      agentPort: Number(row.agent_port),
      token: openSeal(row.agent_token),
    };
  } catch {
    throw new Error("Пароль не прочитался. Добавьте сервер заново");
  }
}

export const installMegaNode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = typeof input === "string" ? input : input && typeof input === "object" ? (input as { id?: unknown }).id : "";
    if (typeof id !== "string" || !UUID.test(id)) throw new Error("Сервер не найден");
    return id;
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const node = await secretOf(data);
    const sql = await getSql();
    try {
      const { installAgent } = await import("@/lib/social/mega-ssh.server");
      await installAgent({
        host: node.host,
        port: node.sshPort,
        username: node.sshUser,
        password: node.password,
        disk: node.diskName,
        agentPort: node.agentPort,
        token: node.token,
      });
      const probe = await fetch(`http://${node.host}:${node.agentPort}/health`, {
        headers: { Authorization: `Bearer ${node.token}` },
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
      const body = probe ? ((await probe.json().catch(() => null)) as { ok?: boolean; used?: number } | null) : null;
      if (!probe?.ok || !body?.ok) {
        await sql`update mega_nodes set status = 'error', detail = 'Скрипт запущен, снаружи порт не открыт' where id = ${data}`;
        throw new Error("Скрипт запущен, снаружи порт не открыт");
      }
      await sql`
        update mega_nodes
        set status = 'ready', detail = 'Работает', used_bytes = ${Number(body.used) || 0}
        where id = ${data}
      `;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не поставилось";
      if (message !== "Скрипт запущен, снаружи порт не открыт") {
        await sql`update mega_nodes set status = 'error', detail = ${message.slice(0, 180)} where id = ${data}`;
      }
      throw new Error(message);
    }
    return listNodes();
  });

export const checkMegaNode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = typeof input === "string" ? input : input && typeof input === "object" ? (input as { id?: unknown }).id : "";
    if (typeof id !== "string" || !UUID.test(id)) throw new Error("Сервер не найден");
    return id;
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const node = await secretOf(data);
    const sql = await getSql();
    const probe = await fetch(`http://${node.host}:${node.agentPort}/health`, {
      headers: { Authorization: `Bearer ${node.token}` },
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    const body = probe ? ((await probe.json().catch(() => null)) as { ok?: boolean; used?: number } | null) : null;
    if (!probe?.ok || !body?.ok) {
      await sql`update mega_nodes set status = 'error', detail = 'Не отвечает' where id = ${data}`;
    } else {
      await sql`
        update mega_nodes set status = 'ready', detail = 'Работает', used_bytes = ${Number(body.used) || 0}
        where id = ${data}
      `;
    }
    return listNodes();
  });

export const removeMegaNode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = typeof input === "string" ? input : input && typeof input === "object" ? (input as { id?: unknown }).id : "";
    if (typeof id !== "string" || !UUID.test(id)) throw new Error("Сервер не найден");
    return id;
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const taken = await sql<{ n: number | string }>`select count(*)::int as n from mega_grants where node_id = ${data}`;
    if (Number(taken[0]?.n ?? 0) > 0) throw new Error("На этом диске ещё есть подписки");
    await sql`delete from mega_nodes where id = ${data}`;
    return listNodes();
  });
