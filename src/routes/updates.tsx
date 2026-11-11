import { createFileRoute, redirect } from "@tanstack/react-router";
import { normalizeLang } from "@/lib/i18n";

export const Route = createFileRoute("/updates")({
  validateSearch: (search: Record<string, unknown>) => {
    const lang = normalizeLang(search.lang);
    return lang ? { lang } : {};
  },
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/about",
      search: search.lang ? { lang: search.lang } : {},
      hash: "journal",
      replace: true,
    });
  },
});
