import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";

export const Route = createFileRoute("/api/avatar/$userId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const id = params.userId;
        if (!id || id.length > 128 || /[^\w-]/.test(id)) return new Response(null, { status: 404 });
        const sql = await getSql();
        const rows = await sql<{ mime: string; data: string }>`
          select mime, data from profile_avatars where user_id = ${id} limit 1
        `;
        const row = rows[0];
        if (!row?.data) return new Response(null, { status: 404 });
        const bytes = Buffer.from(row.data, "base64");
        return new Response(bytes, {
          headers: {
            "content-type": row.mime === "image/jpeg" ? "image/jpeg" : "application/octet-stream",
            "cache-control": "public, max-age=60",
          },
        });
      },
    },
  },
});
