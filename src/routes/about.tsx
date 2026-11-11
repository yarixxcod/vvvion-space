import { createFileRoute } from "@tanstack/react-router";
import { AboutBody } from "@/components/yaronetic/about-pages";
import { PublicPage, ShareLink } from "@/components/yaronetic/public-page";
import { aboutCopy, langOf, normalizeLang, ui, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { seoHead } from "@/lib/seo";

export const Route = createFileRoute("/about")({
  validateSearch: (search: Record<string, unknown>): { lang?: Lang } => {
    const lang = normalizeLang(search.lang);
    return lang ? { lang } : {};
  },
  head: ({ match }) => {
    const lang = langOf(match.search.lang);
    const copy = aboutCopy(lang);
    return seoHead(lang, "/about", copy.title, copy.description);
  },
  component: AboutPage,
});

function AboutPage() {
  const lang = useLang();
  const copy = aboutCopy(lang);
  return (
    <PublicPage title={ui(lang, "about")} path="/about" description={copy.lead}>
      <ShareLink path="/about" title={copy.title} text={copy.description} />
      <AboutBody />
    </PublicPage>
  );
}
