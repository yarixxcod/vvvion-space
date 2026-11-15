import { getSql, withTransaction } from "@/lib/db";
import { isPremium, PREMIUM_DISK } from "@/lib/social/premium";
import { storeMegaBytes, createMegaFolderForUser } from "@/lib/social/mega";
import { DISK_BASE, newId } from "@/lib/social/disk";

export function agentName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 75 || /[/\\\u0000-\u001f]/.test(name) || name === "." || name === "..")
    throw new Error("Укажите имя до 75 символов без слешей и управляющих знаков");
  return name;
}

export async function createAgentFolder(
  userId: string,
  storage: "disk" | "mega",
  name: string,
  parent: string | null,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (storage === "mega") return createMegaFolderForUser(userId, name, parent);
  if (parent)
    throw new Error("На Диске папки одноуровневые. Для вложенных папок используйте Мегадиск.");
  const sql = await getSql();
  const id = newId();
  const rows = await sql<{
    id: string;
    name: string;
  }>`insert into disk_folders (id, user_id, name) values (${id}, ${userId}, ${name}) on conflict (user_id, name) do update set name = excluded.name returning id, name`;
  return { ...rows[0], storage, created: rows[0].id === id };
}

export async function saveAgentText(
  userId: string,
  storage: "disk" | "mega",
  name: string,
  text: string,
  folder: string | null,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const bytes = new TextEncoder().encode(text);
  const mime = /\.json$/i.test(name)
    ? "application/json"
    : /\.csv$/i.test(name)
      ? "text/csv;charset=utf-8"
      : /\.md$/i.test(name)
        ? "text/markdown;charset=utf-8"
        : "text/plain;charset=utf-8";
  if (storage === "mega") {
    const file = await storeMegaBytes(userId, name, mime, bytes, 0, folder, signal);
    return { ...file, storage, url: `/api/mega/${file.id}`, bytes: bytes.length, saved: true };
  }
  const extra = (await isPremium(userId)) ? PREMIUM_DISK : 0;
  return withTransaction(async (sql) => {
    await sql`insert into disk_accounts (user_id, bonus_bytes) values (${userId}, 0) on conflict (user_id) do nothing`;
    const account = await sql<{
      bonus_bytes: number;
    }>`select bonus_bytes from disk_accounts where user_id = ${userId} for update`;
    if (folder) {
      const owned =
        await sql`select id from disk_folders where id = ${folder} and user_id = ${userId}`;
      if (!owned.length) throw new Error("Папка не найдена на вашем Диске");
    }
    const used = await sql<{
      total: string;
    }>`select coalesce(sum(bytes), 0)::text as total from disk_files where user_id = ${userId}`;
    if (Number(used[0].total) + bytes.length > DISK_BASE + extra + Number(account[0].bonus_bytes))
      throw new Error("На Диске недостаточно места");
    const id = newId();
    const duplicates =
      await sql`select id from disk_files where user_id = ${userId} and folder_id is not distinct from ${folder} and name = ${name} limit 1`;
    const dot = name.lastIndexOf(".");
    const extension = dot >= 0 ? name.slice(dot) : "";
    const suffix = ` (${id.slice(0, 6)})`;
    const label = duplicates.length
      ? `${name.slice(0, dot >= 0 ? dot : name.length).slice(0, 75 - suffix.length - extension.length)}${suffix}${extension}`
      : name;
    const encoded = Buffer.from(bytes).toString("base64");
    signal?.throwIfAborted();
    await sql`insert into disk_files (id, user_id, name, mime, bytes, kind, data, folder_id) values (${id}, ${userId}, ${label}, ${mime}, ${bytes.length}, 'file', ${encoded}, ${folder})`;
    signal?.throwIfAborted();
    return { id, name: label, storage, url: `/api/disk/${id}`, bytes: bytes.length, saved: true };
  });
}
