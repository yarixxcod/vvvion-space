import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertActive } from "@/lib/social/access";

export type PublicGift = { sku: string; title: string; count: number };
export type PublicPerson = {
  id: string;
  name: string;
  image: string | null;
  handle: string | null;
  country: string;
  city: string;
  birthDate: string;
  joinedAt: string;
  admin: boolean;
  premium: boolean;
  gifts: PublicGift[];
};

function personId(input: unknown): string {
  const id = input && typeof input === "object" ? (input as { id?: unknown }).id : "";
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("Профиль не найден");
  return id;
}

export const readPublicPerson = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(personId)
  .handler(async ({ context, data }): Promise<PublicPerson> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      name: string;
      image: string | null;
      handle: string | null;
      country: string | null;
      city: string | null;
      birth_date: string | null;
      joined_at: string;
      admin: boolean;
      premium: boolean;
    }>`
      select
        u.id,
        u.name,
        u.image,
        h.handle,
        f.country,
        f.city,
        f.birth_date,
        u."createdAt"::text as joined_at,
        exists(select 1 from members m where m.user_id = u.id and m.role = 'admin') as admin,
        exists(select 1 from premium_grants p where p.user_id = u.id and p.until_at > now()) as premium
      from "user" u
      left join user_handles h on h.user_id = u.id
      left join profile_facts f on f.user_id = u.id
      where u.id = ${data}
      limit 1
    `;
    const row = rows[0];
    if (!row) throw new Error("Профиль не найден");
    const gifts = await sql<{ sku: string; title: string; count: number }>`
      select sku, title, count(*)::int as count
      from gift_receipts
      where to_id = ${data} and sold_at is null
      group by sku, title
      order by max(created_at) desc
      limit 24
    `;
    return {
      id: row.id,
      name: row.name,
      image: row.image,
      handle: row.handle,
      country: row.country || "",
      city: row.city || "",
      birthDate: row.birth_date || "",
      joinedAt: row.joined_at,
      admin: Boolean(row.admin),
      premium: Boolean(row.premium),
      gifts: gifts.map((gift) => ({ sku: gift.sku, title: gift.title, count: Number(gift.count) || 1 })),
    };
  });
