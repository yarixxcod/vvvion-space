import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { RELEASE } from "@/lib/release";

export const getServiceStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const checkedAt = new Date().toISOString();
    const base = {
      version: RELEASE,
      commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 8),
      checkedAt,
    };
    try {
      const sql = await getSql();
      await sql`select 1 as ok`;
      const results = await Promise.allSettled([
        sql<{ n: number }>`select count(*)::int as n from catalog_models`,
        sql<{
          n: number;
        }>`select count(*)::int as n from disk_files where user_id = ${context.userId}`,
        sql<{
          active: boolean;
          status: string | null;
        }>`select (g.until_at > now()) as active, n.status from mega_grants g left join mega_nodes n on n.id = g.node_id where g.user_id = ${context.userId}`,
      ]);
      return {
        ...base,
        database: true,
        models: results[0].status === "fulfilled" ? (results[0].value[0]?.n ?? 0) : null,
        disk: results[1].status === "fulfilled",
        mega: results[2].status === "fulfilled" ? (results[2].value[0] ?? null) : null,
      };
    } catch {
      return { ...base, database: false, models: null, disk: false, mega: null };
    }
  });
