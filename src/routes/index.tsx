import { createFileRoute } from "@tanstack/react-router";
import { App } from "@/components/yaronetic/app";
import { homeSeo, langOf, normalizeLang, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { isCircleTab, type CircleTab } from "@/lib/places";
import { seoHead, websiteJsonLd } from "@/lib/seo";
import { listModels } from "@/lib/social/admin";

function cleanId(value: unknown) {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) return undefined;
  return id;
}

const SHOP_SECTIONS = new Set(["main", "subs", "ai", "storage", "look", "gifts"]);

function topupId(value: unknown) {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : undefined;
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { place?: CircleTab; lang?: Lang; chat?: string; room?: string; new?: boolean; topup?: string; s?: string } => {
    const lang = normalizeLang(search.lang);
    const chat = cleanId(search.chat);
    const room = cleanId(search.room);
    const fresh = search.new === 1 || search.new === "1" || search.new === true || search.new === "true";
    const topup = topupId(search.topup);
    const section = typeof search.s === "string" && SHOP_SECTIONS.has(search.s) ? search.s : undefined;
    return {
      place: isCircleTab(search.place) ? search.place : undefined,
      ...(lang ? { lang } : {}),
      ...(chat ? { chat } : {}),
      ...(room ? { room } : {}),
      ...(fresh ? { new: true } : {}),
      ...(topup ? { topup } : {}),
      ...(section ? { s: section } : {}),
    };
  },
  loaderDeps: () => ({}),
  loader: () => listModels().catch(() => []),
  head: ({ match }) => {
    const lang = langOf(match.search.lang);
    const seo = homeSeo(lang);
    return seoHead(lang, "/", seo.title, seo.description);
  },
  component: Home,
});

function Home() {
  const models = Route.useLoaderData();
  const { place, chat, room, new: startNew } = Route.useSearch();
  const lang = useLang();
  const seo = homeSeo(lang);
  return (
    <>
      <App initialModels={models} place={place} openChat={chat} openRoom={room} startNew={startNew} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd(seo.description)) }} />
    </>
  );
}
