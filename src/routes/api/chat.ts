import { createFileRoute } from "@tanstack/react-router";
import { handleChat } from "@/lib/ai/proxy.server";
import { handleGuestStatus } from "@/lib/ai/guest.server";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      GET: ({ request }) => handleGuestStatus(request),
      POST: ({ request }) => handleChat(request),
    },
  },
});
