import { aboutCopy, type FaqItem, type Lang } from "@/lib/i18n";
import { absoluteUrl } from "@/lib/places";

export function localeOf(lang: Lang): string {
  if (lang === "en") return "en_US";
  if (lang === "kk") return "kk_KZ";
  return "ru_RU";
}

export function localizedUrl(path: string, lang: Lang): string {
  const clean = path.split("?")[0] || "/";
  const url = absoluteUrl(clean === "" ? "/" : clean);
  return lang === "ru" ? url : `${url}?lang=${lang}`;
}

const LANGS: Lang[] = ["ru", "en", "kk"];

export function seoHead(lang: Lang, path: string, title: string, description: string) {
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" },
      { name: "googlebot", content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" },
      { name: "bingbot", content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" },
      { name: "author", content: "vvvion.space" },
      { name: "application-name", content: "vvvion.space" },
      { property: "og:locale", content: localeOf(lang) },
    ],
    links: [
      { rel: "canonical", href: localizedUrl(path, lang) },
      ...LANGS.map((code) => ({ rel: "alternate", hrefLang: code, href: localizedUrl(path, code) })),
      { rel: "alternate", hrefLang: "x-default", href: localizedUrl(path, "ru") },
    ],
  };
}

export function websiteJsonLd(description: string) {
  const origin = absoluteUrl("/");
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${origin}#website`,
        name: "vvvion.space",
        url: origin,
        description,
        inLanguage: ["ru", "en", "kk"],
        publisher: { "@id": `${origin}#organization` },
      },
      {
        "@type": "Organization",
        "@id": `${origin}#organization`,
        name: "vvvion.space",
        url: origin,
        logo: {
          "@type": "ImageObject",
          url: absoluteUrl("/icon-512.png"),
        },
      },
      {
        "@type": "SoftwareApplication",
        name: "vvvion.space",
        applicationCategory: "CommunicationApplication",
        operatingSystem: "Web, Android, iOS",
        url: origin,
        description,
        inLanguage: ["ru", "en", "kk"],
        offers: { "@type": "Offer", "price": "0", "priceCurrency": "RUB" },
      },
    ],
  };
}

export function faqJsonLd(items: FaqItem[], path: string, lang: Lang) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: lang,
    url: localizedUrl(path, lang),
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

export function aboutJsonLd(lang: Lang) {
  const copy = aboutCopy(lang);
  return [faqJsonLd(copy.faq, "/about", lang)];
}
