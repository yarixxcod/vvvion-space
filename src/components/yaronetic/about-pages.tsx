import { useEffect, useState, type ReactNode } from "react";
import { BackButton } from "@/components/yaronetic/back-button";
import { NOTES, RELEASE, markReleaseRead, updatesUnread, type NoteKind } from "@/lib/release";
import { PLACES, absoluteUrl, placePath } from "@/lib/places";
import { ShareLink } from "@/components/yaronetic/public-page";
import { aboutCopy, fill, placeCopy, ui, type Lang, type UiKey } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { faqJsonLd } from "@/lib/seo";

const KIND: Record<NoteKind, UiKey> = {
  added: "kindAdded",
  fixed: "kindFixed",
  fresh: "kindFresh",
  better: "kindBetter",
  tuned: "kindTuned",
  opened: "kindOpened",
};

export function AboutBody() {
  const lang = useLang();
  const copy = aboutCopy(lang);
  useEffect(() => {
    const unread = updatesUnread();
    markReleaseRead();
    if (!unread && window.location.hash !== "#journal") return;
    const target = document.getElementById("journal");
    target?.scrollIntoView({ block: "start" });
  }, []);
  return (
    <>
      {copy.blocks.map((block) => (
        <Block key={block.title} title={block.title}>
          {block.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </Block>
      ))}
      <Journal lang={lang} />
      <Block title={ui(lang, "addresses")}>
        <p>{ui(lang, "addressLead")}</p>
        <ul className="space-y-2">
          {PLACES.map((place) => {
            const item = placeCopy(place.slug, lang);
            return (
              <li key={place.slug} className="rounded-2xl border border-line px-3 py-2">
                <a href={placePath(place.slug)} className="text-sm text-fg underline-offset-2 hover:underline">
                  {item?.name ?? place.name}
                </a>
                <p className="mt-1 text-base leading-relaxed text-muted">{item?.description ?? place.description}</p>
                <p className="mt-1 break-all font-mono text-xs text-muted">{absoluteUrl(placePath(place.slug))}</p>
              </li>
            );
          })}
        </ul>
      </Block>
      <Block title={ui(lang, "install")}>
        <InstallHint />
      </Block>
      {copy.legal.map((block) => (
        <Block key={block.title} title={block.title}>
          {block.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </Block>
      ))}
      <section className="mt-4 rounded-3xl border border-line bg-elev p-4" id="faq">
        <h2 className="font-serif text-xl tracking-tight">{ui(lang, "faq")}</h2>
        <div className="mt-3 space-y-2">
          {copy.faq.map((item) => (
            <details key={item.q} className="rounded-2xl border border-line px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-fg">{item.q}</summary>
              <p className="mt-2 text-base leading-relaxed text-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </section>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(copy.faq, "/about", lang)) }} />
    </>
  );
}

export function AboutSheet({ onClose }: { onClose: () => void }) {
  const lang = useLang();
  const copy = aboutCopy(lang);
  return (
    <Sheet title={ui(lang, "about")} onClose={onClose}>
      <ShareLink path="/about" title={copy.title} text={copy.description} />
      <AboutBody />
    </Sheet>
  );
}

function Journal({ lang }: { lang: Lang }) {
  return (
    <section className="mt-4 scroll-mt-4" id="journal">
      <h2 className="font-serif text-2xl tracking-tight">{ui(lang, "updatesTitle")}</h2>
      <p className="mt-2 text-base leading-relaxed text-muted">{fill(ui(lang, "updatesLead"), { version: RELEASE })}</p>
      <p className="mt-2 text-base leading-relaxed text-faint">{ui(lang, "updatesNote")}</p>
      <ol className="mt-4 space-y-3">
        {NOTES.map((note) => (
          <li key={note.version} className="rounded-3xl border border-line bg-elev p-4">
            <p className="font-mono text-xs tracking-wide text-faint">{note.version}</p>
            <h3 className="mt-1 font-serif text-2xl tracking-tight">{note.title}</h3>
            <p className="mt-2 text-base leading-relaxed text-fg">{note.lead}</p>
            <ul className="mt-4 space-y-3">
              {note.lines.map((line) => (
                <li key={line.text} className="grid gap-1 border-t border-line pt-3 sm:grid-cols-[9.5rem_1fr] sm:gap-3">
                  <span className="text-xs font-medium tracking-wide text-accent">{ui(lang, KIND[line.kind])}</span>
                  <span className="text-base leading-relaxed text-muted">{line.text}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

function InstallHint() {
  const lang = useLang();
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (standalone) {
    return <p>{ui(lang, "installed")}</p>;
  }

  return (
    <>
      <p>{ui(lang, "installLead")}</p>
      <p>{ui(lang, "installOffline")}</p>
      {prompt ? (
        <button
          type="button"
          className="press mt-2 h-10 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg"
          onClick={() => {
            void prompt.prompt();
            void prompt.userChoice.finally(() => setPrompt(null));
          }}
        >
          {ui(lang, "installButton")}
        </button>
      ) : ios ? (
        <p>
          {ui(lang, "installIos")}{" "}
          <a href="/?install=1&platform=ios" className="text-fg underline-offset-2 hover:underline">
            {ui(lang, "installLook")}
          </a>
          .
        </p>
      ) : (
        <p>{ui(lang, "installBrowser")}</p>
      )}
    </>
  );
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 rounded-3xl border border-line bg-elev p-4">
      <h2 className="font-serif text-xl tracking-tight">{title}</h2>
      <div className="mt-2 space-y-2 text-base leading-relaxed text-muted">{children}</div>
    </section>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const lang = useLang();
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45">
      <button type="button" className="absolute inset-0" aria-label={ui(lang, "close")} onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-line bg-bg">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-bg/90 px-4 py-3 backdrop-blur">
          <div className="flex min-w-0 items-center gap-1">
            <BackButton onClick={onClose} label={ui(lang, "close")} />
            <h2 className="truncate font-serif text-2xl tracking-tight">{title}</h2>
          </div>
          <button type="button" className="press hidden h-10 rounded-xl px-3 text-sm text-muted md:inline-flex" onClick={onClose}>
            {ui(lang, "close")}
          </button>
        </div>
        <div className="px-4 pt-4 pb-10">{children}</div>
      </div>
    </div>
  );
}
