import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertActive } from "@/lib/social/access";
import { isPremium } from "@/lib/social/premium";
import { isUniqueViolation } from "@/lib/social/sql-error";
import { loadPrices, priceOf } from "@/lib/social/prices";

export type PersonaCard = {
  id: string;
  name: string;
  role: string;
  price: number;
  face: string;
  owned: boolean;
  viaPremium: boolean;
  prompt: string | null;
};

export type PersonaShop = {
  items: PersonaCard[];
  activeId: string | null;
};

async function catalog() {
  return import("@/lib/social/persona-data");
}

function personaIdOf(known: Set<string>, value: unknown): string {
  const raw = typeof value === "string" ? value : value && typeof value === "object" ? (value as { id?: unknown }).id : "";
  const id = typeof raw === "string" ? raw.trim() : "";
  if (!known.has(id)) throw new Error("Такого персонажа нет");
  return id;
}

async function readShop(userId: string): Promise<PersonaShop> {
  const { PERSONAS } = await catalog();
  const sql = await getSql();
  const owned = await sql<{ persona_id: string }>`
    select persona_id from owned_personas where user_id = ${userId}
  `;
  const active = await sql<{ persona_id: string }>`
    select persona_id from active_persona where user_id = ${userId}
  `;
  const have = new Set(owned.map((row) => row.persona_id));
  const premium = await isPremium(userId);
  const prices = await loadPrices();
  let activeId: string | null = active[0]?.persona_id ?? null;
  if (activeId && !have.has(activeId) && !premium) {
    await sql`delete from active_persona where user_id = ${userId}`;
    activeId = null;
  }
  return {
    activeId,
    items: PERSONAS.map((item) => {
      const mine = have.has(item.id);
      const viaPremium = premium && !mine;
      return {
        id: item.id,
        name: item.name,
        role: item.role,
        price: prices.get(`persona:${item.id}`) ?? item.price,
        face: `/personas/${item.id}.svg`,
        owned: mine,
        viaPremium,
        prompt: mine || premium ? item.prompt : null,
      };
    }),
  };
}

export async function ownedPersonaPrompt(userId: string, id: string): Promise<string> {
  const { personaById } = await catalog();
  const persona = personaById(id);
  if (!persona) return "";
  const sql = await getSql();
  const rows = await sql<{ persona_id: string }>`
    select persona_id from owned_personas
    where user_id = ${userId} and persona_id = ${id}
    limit 1
  `;
  if (rows.length || (await isPremium(userId))) return persona.prompt;
  return "";
}

export const getPersonaShop = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<PersonaShop> => {
    await assertActive(context.userId);
    return readShop(context.userId);
  });

export async function purchasePersona(userId: string, id: string, idem?: string): Promise<PersonaShop> {
  const { PERSONAS, personaById } = await catalog();
  if (!PERSONAS.some((item) => item.id === id)) throw new Error("Такого персонажа нет");
  const persona = personaById(id);
  if (!persona) throw new Error("Такого персонажа нет");
  const price = await priceOf(`persona:${id}`, persona.price);
  const sql = await getSql();
  await sql`
    insert into wallets (user_id, balance, last_grant_at)
    values (${userId}, 1000, now())
    on conflict (user_id) do nothing
  `;
  const already = await sql<{ persona_id: string }>`
    select persona_id from owned_personas
    where user_id = ${userId} and persona_id = ${id}
  `;
  if (already.length) throw new Error("Этот персонаж уже куплен");
  const transfer = idem ? `persona-${idem}` : "";
  if (transfer) {
    const prev = await sql<{ id: string }>`select id from wallet_transfers where id = ${transfer}`;
    if (prev.length) return readShop(userId);
  }
  try {
    const done = transfer
      ? await sql<{ id: string }>`
          with debit as (
            update wallets
            set balance = balance - ${price}
            where user_id = ${userId} and balance >= ${price}
            returning user_id
          ),
          owned as (
            insert into owned_personas (user_id, persona_id)
            select ${userId}, ${id}
            where exists (select 1 from debit)
            returning persona_id
          )
          insert into wallet_transfers (id, from_id, to_id, amount, note)
          select ${transfer}, ${userId}, null, ${price}, 'Персонаж'
          where exists (select 1 from owned)
          returning id
        `
      : await sql<{ persona_id: string }>`
          with debit as (
            update wallets
            set balance = balance - ${price}
            where user_id = ${userId} and balance >= ${price}
            returning user_id
          )
          insert into owned_personas (user_id, persona_id)
          select ${userId}, ${id}
          where exists (select 1 from debit)
          returning persona_id
        `;
    if (!done.length) throw new Error(`Нужно ${price} вублей`);
  } catch (err) {
    if (idem && isUniqueViolation(err)) return readShop(userId);
    throw err;
  }
  return readShop(userId);
}

export const buyPersona = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }): Promise<PersonaShop> => {
    await assertActive(context.userId);
    const { PERSONAS } = await catalog();
    const id = personaIdOf(new Set(PERSONAS.map((item) => item.id)), data);
    return purchasePersona(context.userId, id);
  });

export const setActivePersona = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }): Promise<PersonaShop> => {
    await assertActive(context.userId);
    const raw = typeof data === "string" ? data : data && typeof data === "object" ? (data as { id?: unknown }).id : "";
    const id = typeof raw === "string" ? raw.trim() : "";
    const sql = await getSql();
    if (!id) {
      await sql`delete from active_persona where user_id = ${context.userId}`;
      return readShop(context.userId);
    }
    const { PERSONAS } = await catalog();
    if (!PERSONAS.some((item) => item.id === id)) throw new Error("Такого персонажа нет");
    const owned = await sql<{ persona_id: string }>`
      select persona_id from owned_personas
      where user_id = ${context.userId} and persona_id = ${id}
    `;
    if (!owned.length && !(await isPremium(context.userId))) throw new Error("Сначала купите персонажа в магазине");
    await sql`
      insert into active_persona (user_id, persona_id)
      values (${context.userId}, ${id})
      on conflict (user_id) do update set persona_id = ${id}
    `;
    return readShop(context.userId);
  });
