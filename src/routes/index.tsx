import { createFileRoute } from "@tanstack/react-router";
import { App } from "@/components/yaronetic/app";
import { homeSeo, langOf, normalizeLang, placeCopy, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { isCircleTab, placePath, type CircleTab } from "@/lib/places";
import { appsJsonLd, seoHead, websiteJsonLd } from "@/lib/seo";
import { serviceView, type ServiceView } from "@/lib/service-view";
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
  validateSearch: (search: Record<string, unknown>): { place?: CircleTab; lang?: Lang; chat?: string; room?: string; new?: boolean; topup?: string; s?: string; book?: string; view?: "read" | "watch" | "mega"; svc?: ServiceView; event?: string } => {
    const lang = normalizeLang(search.lang);
    const chat = cleanId(search.chat);
    const room = cleanId(search.room);
    const fresh = search.new === 1 || search.new === "1" || search.new === true || search.new === "true";
    const topup = topupId(search.topup);
    const section = typeof search.s === "string" && SHOP_SECTIONS.has(search.s) ? search.s : undefined;
    const event = cleanId(search.event);
    const svc = serviceView(search.svc);
    return {
      place: isCircleTab(search.place) ? search.place : undefined,
      ...(lang ? { lang } : {}),
      ...(chat ? { chat } : {}),
      ...(room ? { room } : {}),
      ...(fresh ? { new: true } : {}),
      ...(topup ? { topup } : {}),
      ...(section ? { s: section } : {}),
      ...(cleanId(search.book) ? { book: cleanId(search.book) } : {}),
      ...(search.view === "read" || search.view === "watch" || search.view === "mega" ? { view: search.view } : {}),
      ...(svc ? { svc } : {}),
      ...(event ? { event } : {}),
    };
  },
  loaderDeps: () => ({}),
  loader: () => listModels().catch(() => []),
  head: ({ match }) => {
    const lang = langOf(match.search.lang);
    const place = match.search.place;
    if (place === "admin") {
      return { meta: [{ title: "vvvion.space" }, { name: "robots", content: "noindex, nofollow" }] };
    }
    if (place) {
      const slug = place === "chat" ? "messages" : place;
      const copy = placeCopy(slug, lang);
      if (copy) return seoHead(lang, placePath(slug), copy.title, copy.description);
    }
    const seo = homeSeo(lang);
    return seoHead(lang, "/", seo.title, seo.description);
  },
  component: Home,
});

function Home() {
  const models = Route.useLoaderData();
  const { place, chat, room, new: startNew, svc, event } = Route.useSearch();
  const lang = useLang();
  const seo = homeSeo(lang);
  const graph = place === "apps" ? appsJsonLd(lang) : websiteJsonLd(seo.description);
  return (
    <>
      <App initialModels={models} place={place} openChat={chat} openRoom={room} startNew={startNew} svc={svc} eventId={event} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }} />
    </>
  );
}
