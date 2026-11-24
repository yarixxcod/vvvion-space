import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { desktopUpdate } from "@/lib/social/desktop-release.server";

export const Route = createFileRoute("/api/app/desktop/update/$target/$arch/$version")({
  server: {
    handlers: {
      GET: async ({ request }) => desktopUpdate(await getSql(), request),
    },
  },
});
