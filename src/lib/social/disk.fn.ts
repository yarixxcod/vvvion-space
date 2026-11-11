import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertActive } from "@/lib/social/access";
import { isUniqueViolation } from "@/lib/social/sql-error";
import { priceOf } from "@/lib/social/prices";
import { DISK_COST, DISK_STEP, diskName, newId, quotaOf, readDisk, type DiskFile, type DiskSnapshot } from "@/lib/social/disk";
import { DISK_ID } from "@/lib/social/disk-path";
import { mediaKind, type ShareEntry, type SharePageData } from "@/lib/share-view";

export const getDisk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<DiskSnapshot> => {
    await assertActive(context.userId);
    return readDisk(context.userId);
  });

export const deleteDiskFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = typeof input === "string" ? input : input && typeof input === "object" ? (input as { id?: unknown }).id : "";
    if (typeof id !== "string" || !DISK_ID.test(id)) throw new Error("Файл не найден");
    return id;
  })
  .handler(async ({ context, data }): Promise<DiskSnapshot> => {
    await assertActive(context.userId);
    const sql = await getSql();
    await sql`delete from disk_files where id = ${data} and user_id = ${context.userId}`;
    return readDisk(context.userId);
  });

export async function purchaseDiskSpace(userId: string, idem?: string): Promise<{ quota: number }> {
  const price = await priceOf("disk", DISK_COST);
  const sql = await getSql();
  await sql`
    insert into wallets (user_id, balance, last_grant_at)
    values (${userId}, 1000, now())
    on conflict (user_id) do nothing
  `;
  await sql`
    insert into disk_accounts (user_id, bonus_bytes)
    values (${userId}, 0)
    on conflict (user_id) do nothing
  `;
  if (!idem) {
    const done = await sql<{ user_id: string }>`
      with debit as (
        update wallets
        set balance = balance - ${price}
        where user_id = ${userId} and balance >= ${price}
        returning user_id
      )
      update disk_accounts
      set bonus_bytes = bonus_bytes + ${DISK_STEP}
      where user_id = ${userId} and exists (select 1 from debit)
      returning user_id
    `;
    if (!done.length) throw new Error(`Нужно ${price} вублей`);
    const { quota } = await quotaOf(userId);
    return { quota };
  }
  const id = `disk-${idem}`;
  const prev = await sql<{ id: string }>`select id from wallet_transfers where id = ${id}`;
  if (prev.length) {
    const { quota } = await quotaOf(userId);
    return { quota };
  }
  try {
    const done = await sql<{ id: string }>`
      with debit as (
        update wallets
        set balance = balance - ${price}
        where user_id = ${userId} and balance >= ${price}
        returning user_id
      ),
      grown as (
        update disk_accounts
        set bonus_bytes = bonus_bytes + ${DISK_STEP}
        where user_id = ${userId} and exists (select 1 from debit)
        returning user_id
      )
      insert into wallet_transfers (id, from_id, to_id, amount, note)
      select ${id}, ${userId}, null, ${price}, 'Диск'
      where exists (select 1 from grown)
      returning id
    `;
    if (!done.length) throw new Error(`Нужно ${price} вублей`);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
  const { quota } = await quotaOf(userId);
  return { quota };
}

export const buyDiskSpace = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ quota: number }> => {
    await assertActive(context.userId);
    return purchaseDiskSpace(context.userId);
  });

export const shareDisk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ token: string }> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const existing = await sql<{ token: string }>`select token from disk_shares where user_id = ${context.userId}`;
    if (existing[0]?.token) return { token: existing[0].token };
    const token = newId();
    await sql`insert into disk_shares (user_id, token) values (${context.userId}, ${token})`;
    return { token };
  });

export const readSharedDisk = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const token = typeof input === "string" ? input : "";
    if (!DISK_ID.test(token)) throw new Error("Ссылка не действует");
    return token;
  })
  .handler(async ({ data }): Promise<{ owner: string; files: DiskFile[] } | null> => {
    const sql = await getSql();
    const rows = await sql<{ user_id: string; name: string | null }>`
      select s.user_id, u.name
      from disk_shares s
      join "user" u on u.id = s.user_id
      where s.token = ${data}
      limit 1
    `;
    const owner = rows[0];
    if (!owner) return null;
    const disk = await readDisk(owner.user_id);
    return {
      owner: owner.name || "Участник",
      files: disk.files.map((file) => ({ ...file, url: `${file.url}?s=${encodeURIComponent(data)}` })),
    };
  });

const FOLDER_ID = /^[A-Za-z0-9_-]{8,80}$/;

export const readPublicDisk = createServerFn({ method: "GET" })
  .validator((input: unknown): { token: string; folder: string | null } => {
    const raw = input && typeof input === "object" ? (input as { token?: unknown; folder?: unknown }) : {};
    const token = typeof raw.token === "string" && DISK_ID.test(raw.token) ? raw.token : "";
    const folder = typeof raw.folder === "string" && FOLDER_ID.test(raw.folder) ? raw.folder : null;
    return { token, folder };
  })
  .handler(async ({ data }): Promise<SharePageData | null> => {
    if (!data.token) return null;
    const sql = await getSql();
    const shares = await sql<{ user_id: string }>`
      select user_id from disk_shares where token = ${data.token} limit 1
    `;
    const owner = shares[0]?.user_id;
    if (!owner) return null;
    const folders = await sql<{ id: string; name: string }>`
      select id, name from disk_folders where user_id = ${owner} order by lower(name)
    `;
    const here = data.folder && folders.some((item) => item.id === data.folder) ? data.folder : null;
    const files = here
      ? await sql<{ id: string; name: string; mime: string; bytes: number | string; kind: string }>`
          select id, name, mime, bytes, kind from disk_files
          where user_id = ${owner} and folder_id = ${here}
          order by created_at desc
          limit 200
        `
      : await sql<{ id: string; name: string; mime: string; bytes: number | string; kind: string }>`
          select id, name, mime, bytes, kind from disk_files
          where user_id = ${owner} and folder_id is null
          order by created_at desc
          limit 200
        `;
    const share = encodeURIComponent(data.token);
    const fileEntry = (row: { id: string; name: string; mime: string; bytes: number | string }): ShareEntry => ({
      id: row.id,
      name: row.name,
      kind: "file",
      mime: row.mime || "",
      bytes: Number(row.bytes) || 0,
      media: mediaKind(row.name, row.mime || ""),
      view: `/api/disk/${row.id}?s=${share}&view=1`,
      download: `/api/disk/${row.id}?s=${share}&dl=1`,
    });
    const folderName = here ? folders.find((item) => item.id === here)?.name || "Папка" : "Диск";
    const entries: ShareEntry[] = [
      ...(here
        ? []
        : folders.map((item) => ({
            id: item.id,
            name: item.name,
            kind: "folder" as const,
            mime: "",
            bytes: 0,
            media: "file" as const,
            view: "",
            download: "",
          }))),
      ...files.map(fileEntry),
    ];
    return {
      title: folderName,
      rootId: "root",
      folderId: here ?? "root",
      crumbs: here ? [{ id: "root", name: "Диск" }, { id: here, name: folderName }] : [{ id: "root", name: "Диск" }],
      file: null,
      entries,
    };
  });

export const renameDiskFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { id?: unknown; name?: unknown }) : {};
    const id = typeof raw.id === "string" ? raw.id : "";
    if (!DISK_ID.test(id)) throw new Error("Файл не найден");
    return { id, name: diskName(typeof raw.name === "string" ? raw.name : "") };
  })
  .handler(async ({ context, data }): Promise<DiskSnapshot> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const rows = await sql<{ id: string }>`
      update disk_files set name = ${data.name}
      where id = ${data.id} and user_id = ${context.userId}
      returning id
    `;
    if (!rows[0]) throw new Error("Файл не найден");
    return readDisk(context.userId);
  });

export const makeDiskFolder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => diskName(typeof input === "string" ? input : ""))
  .handler(async ({ context, data }): Promise<DiskSnapshot> => {
    await assertActive(context.userId);
    const sql = await getSql();
    try {
      await sql`insert into disk_folders (id, user_id, name) values (${newId()}, ${context.userId}, ${data})`;
    } catch (error) {
      const text = error instanceof Error ? error.message : "";
      if (/unique|duplicate|disk_folders_name/i.test(text)) throw new Error("Такая папка уже есть");
      throw new Error("Папка не создалась");
    }
    return readDisk(context.userId);
  });

export const removeDiskFolder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = typeof input === "string" ? input : "";
    if (!DISK_ID.test(id)) throw new Error("Папка не найдена");
    return id;
  })
  .handler(async ({ context, data }): Promise<DiskSnapshot> => {
    await assertActive(context.userId);
    const sql = await getSql();
    await sql`delete from disk_folders where id = ${data} and user_id = ${context.userId}`;
    return readDisk(context.userId);
  });

export const moveDiskFiles = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { ids?: unknown; folderId?: unknown }) : {};
    const ids = Array.isArray(raw.ids) ? raw.ids.filter((id): id is string => typeof id === "string" && DISK_ID.test(id)).slice(0, 80) : [];
    if (!ids.length) throw new Error("Нечего перемещать");
    let folderId: string | null = null;
    if (raw.folderId != null && raw.folderId !== "") {
      if (typeof raw.folderId !== "string" || !DISK_ID.test(raw.folderId)) throw new Error("Папка не найдена");
      folderId = raw.folderId;
    }
    return { ids, folderId };
  })
  .handler(async ({ context, data }): Promise<DiskSnapshot> => {
    await assertActive(context.userId);
    const sql = await getSql();
    if (data.folderId) {
      const folders = await sql<{ id: string }>`select id from disk_folders where id = ${data.folderId} and user_id = ${context.userId}`;
      if (!folders[0]) throw new Error("Папка не найдена");
    }
    for (const id of data.ids) {
      await sql`
        update disk_files set folder_id = ${data.folderId}
        where id = ${id} and user_id = ${context.userId}
      `;
    }
    return readDisk(context.userId);
  });
