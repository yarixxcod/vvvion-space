import { useEffect, useState } from "react";
import { BackButton } from "@/components/yaronetic/back-button";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { artistCard, type ArtistNote } from "@/lib/social/artist";
import { splitArtists } from "@/lib/music/artists";
import { useTx } from "@/lib/lang";
import { cn } from "@/lib/utils";

export function ArtistLink({ name, className }: { name: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const clean = name.trim();
  if (!clean) return null;
  return (
    <>
      <button
        type="button"
        className={cn("inline px-0.5 text-left underline decoration-transparent underline-offset-2 hover:decoration-current", className)}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          setOpen(true);
        }}
      >
        {clean}
      </button>
      {open ? <ArtistSheet name={clean} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function ArtistNames({ name, className }: { name: string; className?: string }) {
  const clean = name.replace(/\s+/g, " ").trim();
  const people = splitArtists(clean);
  const shown = people.length ? people : clean.length >= 2 ? [clean.slice(0, 80)] : [];
  if (!shown.length) return null;
  return (
    <span className="inline">
      {shown.map((person, index) => (
        <span key={`${person}:${index}`}>
          {index > 0 ? <span aria-hidden="true">{"\u00A0· "}</span> : null}
          <ArtistLink name={person} className={className} />
        </span>
      ))}
    </span>
  );
}

function ArtistSheet({ name, onClose }: { name: string; onClose: () => void }) {
  const tx = useTx();
  const [row, setRow] = useState<ArtistNote | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    void artistCard({ data: name })
      .then((next) => {
        if (!dead) setRow(next);
      })
      .catch((err: unknown) => {
        if (!dead) setError(err instanceof Error ? err.message : tx({ ru: "Карточка не открылась", en: "The card did not open", kk: "Карточка ашылмады" }));
      });
    return () => {
      dead = true;
    };
  }, [name, tx]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const close = tx({ ru: "Закрыть", en: "Close", kk: "Жабу" });

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/55 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={name}>
      <div className="w-full max-w-md rounded-[1.6rem] border border-line bg-elev p-4 shadow-[var(--shadow)]">
        <div className="flex items-center justify-between gap-2">
          <BackButton onClick={onClose} label={tx({ ru: "Назад", en: "Back", kk: "Артқа" })} />
          <button type="button" className="press hidden h-10 rounded-xl border border-line px-3 text-sm md:inline-flex" onClick={onClose}>
            {close}
          </button>
        </div>
        <p className="mt-2 font-serif text-2xl tracking-tight">{row?.title || name}</p>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        {!error && !row ? <PageLoader compact /> : null}
        {row && !row.text ? <p className="mt-3 text-sm text-muted">{tx({ ru: "Короткой справки не нашлось.", en: "No short note yet.", kk: "Қысқа анықтама табылмады." })}</p> : null}
        {row?.text ? <p className="mt-3 text-sm leading-relaxed text-muted">{row.text}</p> : null}
        {row?.url ? (
          <a href={row.url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-faint underline">
            {tx({ ru: "Источник", en: "Source", kk: "Дереккөз" })}
          </a>
        ) : null}
      </div>
    </div>
  );
}
