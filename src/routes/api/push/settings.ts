import { createFileRoute } from "@tanstack/react-router";
import { handlePushSettingsGet, handlePushSettingsPut } from "@/lib/social/push-http.server";

export const Route = createFileRoute("/api/push/settings")({
  server: {
    handlers: {
      GET: ({ request }) => handlePushSettingsGet(request),
      PUT: ({ request }) => handlePushSettingsPut(request),
    },
  },
});
