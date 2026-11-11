import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { runGrab } from "@/lib/social/grab";

export const Route = createFileRoute("/api/grab")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        const userId = session?.user?.id;
        if (!userId) return Response.json({ message: "Нужен аккаунт" }, { status: 401 });
        let url = "";
        try {
          const body = (await request.json()) as { url?: unknown };
          url = typeof body?.url === "string" ? body.url : "";
        } catch {
          url = "";
        }
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            try {
              const files = await runGrab(userId, url, (tick) => send({ type: "progress", ...tick }));
              send({ type: "done", files });
            } catch (error) {
              send({ type: "error", message: error instanceof Error ? error.message : "Не скачалось" });
            } finally {
              try {
                controller.close();
              } catch {
                /* the client already left */
              }
            }
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "application/x-ndjson; charset=utf-8",
            "cache-control": "no-store",
            "x-accel-buffering": "no",
          },
        });
      },
    },
  },
});
