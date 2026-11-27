import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";

export const Route = createFileRoute("/api/avatar/$userId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const id = params.userId;
        if (!id || id.length > 128 || /[^\w-]/.test(id)) return new Response(null, { status: 404 });
        const sql = await getSql();
        const rows = await sql<{ mime: string; data: string }>`
          select mime, data from profile_avatars where user_id = ${id} limit 1
        `;
        const row = rows[0];
        if (!row?.data) return new Response(null, { status: 404 });
        const bytes = Buffer.from(row.data, "base64");
        // saveAvatar() builds `/api/avatar/<id>?v=<timestamp>`, so a URL WITH ?v= never changes
        // content: let browsers (7 days) and Vercel's CDN (1 day) keep it instead of re-reading
        // the photo (up to 140 KB) from Neon every minute. Not "forever": a deleted photo
        // must stop being served within a day. Bare URLs keep the old short cache.
        const versioned = /^\d{6,}$/.test(new URL(request.url).searchParams.get("v") ?? "");
        return new Response(bytes, {
          headers: {
            "content-type": row.mime === "image/jpeg" ? "image/jpeg" : "application/octet-stream",
            "cache-control": versioned
              ? "public, max-age=604800, s-maxage=86400, immutable"
              : "public, max-age=60, s-maxage=60",
          },
        });
      },
    },
  },
});
