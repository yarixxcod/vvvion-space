import { createFileRoute } from "@tanstack/react-router";
import { speakText } from "@/lib/ai/tts.server";

export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown = {};
        try {
          body = await request.json();
        } catch {
          body = {};
        }
        const text = body && typeof body === "object" && typeof (body as { text?: unknown }).text === "string" ? (body as { text: string }).text : "";
        return speakText(text.slice(0, 8_000));
      },
    },
  },
});
