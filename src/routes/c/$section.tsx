import { useEffect, useState } from "react";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { Circle } from "@/components/yaronetic/circle";
import { PublicPage, ShareLink } from "@/components/yaronetic/public-page";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { langOf, normalizeLang, placeCopy, ui, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { PLACES, absoluteUrl, placeBySlug, placePath } from "@/lib/places";
import { seoHead } from "@/lib/seo";

export const Route = createFileRoute("/c/$section")({
  validateSearch: (search: Record<string, unknown>): { lang?: Lang } => {
    const lang = normalizeLang(search.lang);
    return lang ? { lang } : {};
  },
  loader: ({ params }) => {
    const place = placeBySlug(params.section);
    if (!place) throw notFound();
    return place;
  },
  head: ({ loaderData, match }) => {
    const lang = langOf(match.search.lang);
    const copy = loaderData ? placeCopy(loaderData.slug, lang) : undefined;
    if (!loaderData || !copy) {
      return { meta: [{ title: "vvvion.space" }] };
    }
    return seoHead(lang, placePath(loaderData.slug), copy.title, copy.description);
  },
  component: SectionPage,
});

function SectionPage() {
  const place = Route.useLoaderData();
  const { user, isPending } = useCurrentUserState();
  const [ready, setReady] = useState(false);
  const lang = useLang();
  const copy = placeCopy(place.slug, lang) ?? {
    name: place.name,
    title: place.title,
    description: place.description,
    lead: place.lead,
  };
  useEffect(() => setReady(true), []);
  if (ready && !isPending && user) {
    return (
      <div className="h-dvh">
        <Circle tab={place.tab} />
      </div>
    );
  }
  return (
    <PublicPage
      title={copy.name}
      path={placePath(place.slug)}
      description={copy.description}
      crumbs={[
        { name: "vvvion.space", path: "/" },
        { name: ui(lang, "circle"), path: "/about" },
        { name: copy.name, path: placePath(place.slug) },
      ]}
    >
      <p className="mb-4 text-sm leading-relaxed text-fg">{copy.lead}</p>
      <ShareLink path={placePath(place.slug)} title={copy.title} text={copy.description} />
      <Link to="/login" search={lang === "ru" ? {} : { lang }} className="press mb-6 inline-flex h-11 items-center rounded-2xl border border-line px-3 text-sm">
        {ui(lang, "signInOpen")}
      </Link>
      <nav aria-label={ui(lang, "otherSections")}>
        <ul className="space-y-2">
          {PLACES.filter((item) => item.slug !== place.slug).map((item) => {
            const itemCopy = placeCopy(item.slug, lang);
            return (
              <li key={item.slug}>
                <a href={placePath(item.slug)} className="text-sm text-fg underline-offset-2 hover:underline">
                  {itemCopy?.name ?? item.name}
                </a>
                <p className="break-all font-mono text-xs text-faint">{absoluteUrl(placePath(item.slug))}</p>
              </li>
            );
          })}
        </ul>
      </nav>
    </PublicPage>
  );
}
