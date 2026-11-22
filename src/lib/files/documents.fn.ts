import { encodeDiskBlob, decodeDiskBlob } from "@/lib/storage/disk-blob";
import { createServerFn } from "@tanstack/react-start";
import { createHash } from "node:crypto";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertActive } from "@/lib/social/access";
import { getSql, withTransaction } from "@/lib/db";
import { DISK_BASE } from "@/lib/social/disk";
import { isPremium, PREMIUM_DISK } from "@/lib/social/premium";
import { readMegaDownload, storeMegaBytes } from "@/lib/social/mega";
import { DOCUMENT_MAX, TEXT_MAX, documentKind, isSiteAsset } from "./document-kind";

type Target = { storage: "disk" | "mega"; id: string };
function target(value: unknown): Target {
  const row = value as Partial<Target>;
  if (
    !row ||
    !["disk", "mega"].includes(row.storage ?? "") ||
    typeof row.id !== "string" ||
    !/^[A-Za-z0-9_-]{8,80}$/.test(row.id)
  )
    throw new Error("Файл не найден");
  return { storage: row.storage!, id: row.id };
}
const hash = (data: Uint8Array, name = "") =>
  createHash("sha256")
    .update(name + "\0")
    .update(data)
    .digest("hex");
async function read(userId: string, file: Target, preview = false) {
  await assertActive(userId);
  const sql = await getSql();
  if (file.storage === "disk") {
    const rows = await sql<{
      name: string;
      mime: string;
      data: string;
      bytes: number;
    }>`select name,mime,data,bytes from disk_files where id=${file.id} and user_id=${userId} and (kind='file' or ${preview} and kind='image')`;
    const row = rows[0];
    if (!row || !(preview ? isSiteAsset(row.name) : documentKind(row.name)))
      throw new Error("Этот формат нельзя редактировать");
    if (Number(row.bytes) > DOCUMENT_MAX) throw new Error("Документ больше 3 МБ");
    return { name: row.name, mime: row.mime, bytes: await decodeDiskBlob(userId, row.data) };
  }
  const meta = await sql<{
    name: string;
    bytes: number;
  }>`select name,bytes from mega_entries where id=${file.id} and user_id=${userId} and kind='file' and status='ok'`;
  if (!meta[0] || !(preview ? isSiteAsset(meta[0].name) : documentKind(meta[0].name)))
    throw new Error("Этот формат нельзя редактировать");
  if (Number(meta[0].bytes) > DOCUMENT_MAX) throw new Error("Документ больше 3 МБ");
  const opened = await readMegaDownload(userId, file.id);
  const reader = opened.response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > DOCUMENT_MAX) throw new Error("Документ больше 3 МБ");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { name: opened.name, mime: opened.mime, bytes: Buffer.concat(chunks) };
}
export const readDocument = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(target)
  .handler(async ({ context, data }) => {
    const file = await read(context.userId, data);
    if (documentKind(file.name) === "text" && file.bytes.length > TEXT_MAX)
      throw new Error("Текстовый редактор поддерживает файлы до 1 МБ");
    return {
      name: file.name,
      data: file.bytes.toString("base64"),
      version: hash(file.bytes, file.name),
    };
  });
export const saveDocument = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((value: unknown) => {
    const row = value as Target & { version?: unknown; data?: unknown };
    const base = target(value);
    if (
      typeof row.version !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.version) ||
      typeof row.data !== "string" ||
      row.data.length > Math.ceil((DOCUMENT_MAX * 4) / 3) + 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(row.data)
    )
      throw new Error("Некорректный документ");
    return { ...base, version: row.version, data: row.data };
  })
  .handler(async ({ context, data }) => {
    const userId = context.userId;
    const old = await read(userId, data);
    const bytes = Buffer.from(data.data, "base64");
    if (hash(old.bytes, old.name) !== data.version)
      throw new Error("Файл изменён в другом окне. Скачайте свою правку и откройте свежую версию.");
    const limit = documentKind(old.name) === "docx" ? DOCUMENT_MAX : TEXT_MAX;
    if (
      bytes.length > limit ||
      (documentKind(old.name) === "docx" && (bytes[0] !== 80 || bytes[1] !== 75))
    )
      throw new Error("Формат или размер документа не подходит");
    if (data.storage === "disk") {
      const extra = (await isPremium(userId)) ? PREMIUM_DISK : 0;
      await withTransaction(async (sql) => {
        await sql`insert into disk_accounts(user_id,bonus_bytes) values(${userId},0) on conflict(user_id) do nothing`;
        const accounts = await sql<{
          bonus_bytes: number;
        }>`select bonus_bytes from disk_accounts where user_id=${userId} for update`;
        const rows = await sql<{
          data: string;
          name: string;
          bytes: number;
        }>`select data,name,bytes from disk_files where id=${data.id} and user_id=${userId} for update`;
        if (
          !rows[0] ||
          rows[0].name !== old.name ||
          hash(await decodeDiskBlob(userId, rows[0].data), rows[0].name) !== data.version
        )
          throw new Error("Файл уже изменён. Откройте свежую версию.");
        const used = await sql<{
          size: string;
        }>`select coalesce(sum(bytes),0)::text as size from disk_files where user_id=${userId}`;
        if (
          Number(used[0].size) - Number(rows[0].bytes) + bytes.length >
          DISK_BASE + extra + Number(accounts[0].bonus_bytes)
        )
          throw new Error("На диске недостаточно места");
        await sql`update disk_files set data=${await encodeDiskBlob(userId, bytes)},bytes=${bytes.length} where id=${data.id} and user_id=${userId}`;
      });
      return { id: data.id, name: old.name, backup: false, version: hash(bytes, old.name) };
    }
    if (!bytes.length) throw new Error("Для Мегадиска файл должен содержать хотя бы один символ");
    const sql = await getSql();
    const rows = await sql<{
      parent_id: string | null;
    }>`select parent_id from mega_entries where id=${data.id} and user_id=${userId} and status='ok'`;
    if (!rows[0]) throw new Error("Файл не найден");
    // Upload first: the original remains intact if storage is unavailable or quota is exhausted.
    const staged = await storeMegaBytes(
      userId,
      `правка-${crypto.randomUUID().slice(0, 8)}${old.name.slice(old.name.lastIndexOf("."))}`,
      old.mime,
      bytes,
      0,
      rows[0].parent_id,
    );
    try {
      await withTransaction(async (tx) => {
        const locked = await tx<{
          name: string;
        }>`select name from mega_entries where id=${data.id} and user_id=${userId} and status='ok' for update`;
        const current = await read(userId, data);
        if (
          !locked[0] ||
          locked[0].name !== old.name ||
          hash(current.bytes, current.name) !== data.version
        )
          throw new Error("Исходный файл уже изменён");
        const dot = old.name.lastIndexOf(".");
        const ext = dot >= 0 ? old.name.slice(dot) : "";
        const backup = `${old.name.slice(0, dot >= 0 ? dot : old.name.length).slice(0, 40)} (до правки ${data.id.slice(0, 8)})${ext}`;
        await tx`update mega_entries set name=${backup} where id=${data.id} and user_id=${userId}`;
        await tx`update mega_entries set name=${old.name} where id=${staged.id} and user_id=${userId}`;
      });
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : "Не сохранилось"}. Ваша правка сохранена отдельно как «${staged.name}».`,
      );
    }
    return { id: staged.id, name: old.name, backup: true, version: hash(bytes, old.name) };
  });

export const readSiteAsset = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(target)
  .handler(async ({ context, data }) => {
    const file = await read(context.userId, data, true);
    return { name: file.name, mime: file.mime, data: file.bytes.toString("base64") };
  });

export const uploadDiskDocument = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((value: unknown) => {
    const row = value as { name?: unknown; data?: unknown; folder?: unknown };
    if (
      !row ||
      typeof row.name !== "string" ||
      !row.name.trim() ||
      row.name.length > 75 ||
      // eslint-disable-next-line no-control-regex -- Intentionally reject or strip control bytes from untrusted text.
      /[/\\\u0000-\u001f]/.test(row.name) ||
      !(documentKind(row.name) || isSiteAsset(row.name))
    )
      throw new Error("Поддерживаются документы и ресурсы статического сайта");
    if (
      typeof row.data !== "string" ||
      row.data.length > Math.ceil((DOCUMENT_MAX * 4) / 3) + 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(row.data)
    )
      throw new Error("Файл больше 3 МБ или повреждён");
    const folder =
      typeof row.folder === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(row.folder)
        ? row.folder
        : null;
    return { name: row.name.trim(), data: row.data, folder };
  })
  .handler(async ({ context, data }) => {
    await assertActive(context.userId);
    const userId = context.userId;
    const bytes = Buffer.from(data.data, "base64");
    if (bytes.length > DOCUMENT_MAX) throw new Error("Файл больше 3 МБ");
    const extra = (await isPremium(userId)) ? PREMIUM_DISK : 0;
    const id = crypto.randomUUID();
    await withTransaction(async (sql) => {
      await sql`insert into disk_accounts(user_id,bonus_bytes) values(${userId},0) on conflict(user_id) do nothing`;
      const account = await sql<{
        bonus_bytes: number;
      }>`select bonus_bytes from disk_accounts where user_id=${userId} for update`;
      if (data.folder) {
        const owned =
          await sql`select id from disk_folders where id=${data.folder} and user_id=${userId}`;
        if (!owned.length) throw new Error("Папка не найдена");
      }
      const duplicate =
        await sql`select id from disk_files where user_id=${userId} and folder_id is not distinct from ${data.folder} and name=${data.name}`;
      if (duplicate.length)
        throw new Error(`Файл «${data.name}» уже есть. Переименуйте его перед загрузкой.`);
      const used = await sql<{
        size: string;
      }>`select coalesce(sum(bytes),0)::text as size from disk_files where user_id=${userId}`;
      if (Number(used[0].size) + bytes.length > DISK_BASE + extra + Number(account[0].bonus_bytes))
        throw new Error("На диске недостаточно места");
      const mime =
        documentKind(data.name) === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "text/plain";
      await sql`insert into disk_files(id,user_id,name,mime,bytes,kind,data,folder_id) values(${id},${userId},${data.name},${mime},${bytes.length},'file',${await encodeDiskBlob(userId, bytes)},${data.folder})`;
    });
    return { id, name: data.name };
  });
