import type { ReactNode } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { Mark } from "@/components/yaronetic/mark";
import { Wordmark } from "@/components/yaronetic/wordmark";
import { homeSeo, ui } from "@/lib/i18n";
import { LangSwitch, useLang } from "@/lib/lang";
import { absoluteUrl } from "@/lib/places";
import { localizedUrl } from "@/lib/seo";

export function ShareLink({ path, title, text }: { path: string; title: string; text: string }) {
  const lang = useLang();
  const url = localizedUrl(path, lang);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast(ui(lang, "copied"));
    } catch {
      toast(url);
    }
  }
  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copy();
  }
  return (
    <div className="mb-4 rounded-3xl border border-line bg-elev p-4">
      <p className="text-xs tracking-wide text-faint">{ui(lang, "pageLink")}</p>
      <p className="mt-2 break-all font-mono text-sm text-fg">{url}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="press h-10 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg" onClick={() => void share()}>
          {ui(lang, "share")}
        </button>
        <button type="button" className="press h-10 rounded-xl border border-line px-3 text-sm" onClick={() => void copy()}>
          {ui(lang, "copy")}
        </button>
      </div>
    </div>
  );
}

export function PublicPage({
  title,
  path,
  description,
  crumbs,
  children,
}: {
  title: string;
  path: string;
  description: string;
  crumbs?: { name: string; path: string }[];
  children: ReactNode;
}) {
  const lang = useLang();
  const router = useRouter();
  const url = localizedUrl(path, lang);
  const home = homeSeo(lang);
  const trail = crumbs ?? [
    { name: "vvvion.space", path: "/" },
    { name: title, path },
  ];
  const data = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    description,
    url,
    inLanguage: lang,
    isPartOf: {
      "@type": "WebSite",
      name: "vvvion.space",
      url: absoluteUrl("/"),
      description: home.description,
      inLanguage: ["ru", "en", "kk"],
    },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: trail.map((crumb, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: crumb.name,
        item: absoluteUrl(crumb.path),
      })),
    },
  };
  return (
    <div className="relative min-h-dvh">
      <div className="ambient" aria-hidden="true">
        <div className="orb orb-a" />
        <div className="orb orb-b" />
        <div className="grain" />
      </div>
      <header className="relative z-10 flex items-center gap-3 border-b border-line px-4 py-3">
        <button
          type="button"
          className="press -ml-1 inline-flex size-11 shrink-0 items-center justify-center rounded-2xl text-fg md:hidden"
          aria-label={ui(lang, "toChat")}
          onClick={() => {
            if (window.history.length > 1) router.history.back();
            else void router.navigate({ to: "/" });
          }}
        >
          <ChevronLeft className="size-6" strokeWidth={1.75} />
        </button>
        <Mark size={36} />
        <Wordmark large />
        <div className="ml-auto flex items-center gap-2">
          <LangSwitch compact />
          <Link to="/" search={lang === "ru" ? {} : { lang }} className="press inline-flex h-11 shrink-0 items-center rounded-2xl border border-line bg-elev px-3 text-sm">
            {ui(lang, "toChat")}
          </Link>
        </div>
      </header>
      <main className={`relative z-10 mx-auto w-full px-4 py-8 ${path === "/about" ? "max-w-3xl" : "max-w-2xl"}`}>
        <h1 className="font-serif text-4xl tracking-tight">{title}</h1>
        <p className={`mt-3 leading-relaxed text-muted ${path === "/about" ? "text-base" : "text-sm"}`}>{description}</p>
        <div className="mt-4">{children}</div>
      </main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
    </div>
  );
}
