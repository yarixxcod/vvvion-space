import { createFileRoute } from "@tanstack/react-router";
import { issueChallenge } from "@/lib/security/captcha.server";

export const Route = createFileRoute("/api/captcha")({
  server: {
    handlers: {
      GET: async () => {
        const challenge = await issueChallenge();
        if (!challenge) {
          return new Response(JSON.stringify({ message: "Проверка сейчас недоступна." }), {
            status: 503,
            headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
          });
        }
        return new Response(JSON.stringify(challenge), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        });
      },
    },
  },
});
