import { getRequest } from "@tanstack/react-start/server";
import { auth } from "@/lib/auth/server";
import { getSql } from "@/lib/db";
import type { OwnSession } from "@/lib/auth/sessions";

function deviceLabel(agent: string | null): string {
  const raw = agent || "";
  if (/iPhone|iPad/i.test(raw)) return "Телефон Apple";
  if (/Android/i.test(raw)) return "Телефон Android";
  if (/Mac OS/i.test(raw)) return "Mac";
  if (/Windows/i.test(raw)) return "Windows";
  if (/Linux/i.test(raw)) return "Linux";
  if (/Mobile/i.test(raw)) return "Телефон";
  return "Браузер";
}

async function currentToken(): Promise<string> {
  try {
    const request = getRequest();
    if (!request) return "";
    const session = await auth.api.getSession({ headers: request.headers });
    return session?.session?.token || "";
  } catch {
    return "";
  }
}

export async function readOwnSessions(userId: string): Promise<OwnSession[]> {
  const token = await currentToken();
  const sql = await getSql();
  const rows = await sql<{ id: string; token: string; agent: string | null; created_at: string }>`
    select id, token, "userAgent" as agent, "createdAt"::text as created_at
    from session
    where "userId" = ${userId} and "expiresAt" > now()
    order by "createdAt" desc
    limit 20
  `;
  return rows.map((row) => ({
    id: row.id,
    label: deviceLabel(row.agent),
    at: row.created_at,
    current: Boolean(token) && row.token === token,
  }));
}

export async function dropOwnSession(userId: string, id: string): Promise<{ current: boolean }> {
  const token = await currentToken();
  const sql = await getSql();
  const rows = await sql<{ token: string }>`
    delete from session
    where id = ${id} and "userId" = ${userId}
    returning token
  `;
  const dropped = rows[0]?.token || "";
  return { current: Boolean(dropped) && dropped === token };
}
