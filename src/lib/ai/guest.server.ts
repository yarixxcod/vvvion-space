import { getSql } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/verify.server";
import { ACCOUNT_REQUIRED_MESSAGE, GUEST_QUESTION_LIMIT } from "@/lib/ai/guest-limit";

const COOKIE = "vvvion_guest";
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GuestTicket = {
  ok: boolean;
  used: number;
  remaining: number;
  setCookie: string | null;
  id: string;
};

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

function cookieHeader(id: string): string {
  return `${COOKIE}=${id}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`;
}

function identity(request: Request): { id: string; setCookie: string | null } {
  const current = readCookie(request.headers.get("cookie"), COOKIE);
  if (current && ID_RE.test(current)) return { id: current, setCookie: null };
  const id = crypto.randomUUID();
  return { id, setCookie: cookieHeader(id) };
}

export function withGuestCookie(response: Response, setCookie: string | null): Response {
  if (!setCookie) return response;
  const headers = new Headers(response.headers);
  headers.append("set-cookie", setCookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function readUsed(id: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ used: number }>`
    select used from guest_quota where guest_id = ${id}
  `;
  return Number(rows[0]?.used ?? 0);
}

export async function peekGuest(request: Request): Promise<GuestTicket> {
  const { id, setCookie } = identity(request);
  const sql = await getSql();
  await sql`
    insert into guest_quota (guest_id, used)
    values (${id}, 0)
    on conflict (guest_id) do nothing
  `;
  const used = await readUsed(id);
  return {
    ok: used < GUEST_QUESTION_LIMIT,
    used,
    remaining: Math.max(0, GUEST_QUESTION_LIMIT - used),
    setCookie,
    id,
  };
}

/** Counts one anonymous question. Does not increment once the limit is spent. */
export async function takeGuestQuestion(request: Request): Promise<GuestTicket> {
  const { id, setCookie } = identity(request);
  const sql = await getSql();
  const rows = await sql<{ used: number }>`
    insert into guest_quota (guest_id, used)
    values (${id}, 1)
    on conflict (guest_id) do update
      set used = guest_quota.used + 1,
          updated_at = now()
      where guest_quota.used < ${GUEST_QUESTION_LIMIT}
    returning used
  `;
  if (!rows.length) {
    const used = await readUsed(id);
    return {
      ok: false,
      used,
      remaining: 0,
      setCookie,
      id,
    };
  }
  const used = Number(rows[0]?.used ?? 1);
  return {
    ok: true,
    used,
    remaining: Math.max(0, GUEST_QUESTION_LIMIT - used),
    setCookie,
    id,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function handleGuestStatus(request: Request): Promise<Response> {
  try {
    const user = await getSessionUser();
    if (user) return json({ limited: false, remaining: null, used: 0 });
    const ticket = await peekGuest(request);
    return withGuestCookie(
      json({ limited: true, remaining: ticket.remaining, used: ticket.used }),
      ticket.setCookie,
    );
  } catch (err) {
    console.error("[guest]", err);
    return json({ limited: true, remaining: GUEST_QUESTION_LIMIT, used: 0 });
  }
}

export { ACCOUNT_REQUIRED_MESSAGE };
