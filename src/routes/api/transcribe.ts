import { createFileRoute } from "@tanstack/react-router";
import { handleTranscribe } from "@/lib/ai/transcribe.server";

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      GET: ({ request }) => handleTranscribe(request),
      POST: ({ request }) => handleTranscribe(request),
    },
  },
});
