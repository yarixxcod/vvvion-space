import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertActive } from "@/lib/social/access";

const MAX_CHARS = 180_000;

function jpegPayload(value: unknown): string {
  if (typeof value !== "string") throw new Error("Фото не прочиталось");
  const data = value.replace(/\s/g, "").replace(/^data:image\/jpeg;base64,/, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length < 32 || data.length > MAX_CHARS) {
    throw new Error("Фото слишком большое или повреждено");
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.length < 32 || bytes.length > 140_000) throw new Error("Фото слишком большое");
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error("Нужна фотография JPEG");
  return data;
}

export function avatarUrl(userId: string, version: number): string {
  return `/api/avatar/${encodeURIComponent(userId)}?v=${version}`;
}

export const saveAvatar = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ data: jpegPayload(input && typeof input === "object" ? (input as { data?: unknown }).data : input) }))
  .handler(async ({ context, data }): Promise<{ image: string }> => {
    await assertActive(context.userId);
    const sql = await getSql();
    await sql`
      insert into profile_avatars (user_id, mime, data, updated_at)
      values (${context.userId}, 'image/jpeg', ${data.data}, now())
      on conflict (user_id) do update
        set mime = 'image/jpeg', data = excluded.data, updated_at = now()
    `;
    const version = Date.now();
    const image = avatarUrl(context.userId, version);
    await sql`update "user" set image = ${image} where id = ${context.userId}`;
    return { image };
  });

export const clearAvatar = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ image: null }> => {
    await assertActive(context.userId);
    const sql = await getSql();
    await sql`delete from profile_avatars where user_id = ${context.userId}`;
    await sql`update "user" set image = null where id = ${context.userId}`;
    return { image: null };
  });
