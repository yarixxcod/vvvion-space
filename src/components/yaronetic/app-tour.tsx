import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fill, ui, type UiKey } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import type { CircleTab } from "@/lib/places";

type Step = {
  target: string;
  place: CircleTab | null;
  more: boolean;
  title: UiKey;
  body: UiKey;
};

const STEPS: Step[] = [
  { target: "composer", place: null, more: false, title: "tourWriteTitle", body: "tourWriteBody" },
  { target: "history", place: null, more: false, title: "tourHistoryTitle", body: "tourHistoryBody" },
  { target: "circle", place: null, more: false, title: "tourCircleTitle", body: "tourCircleBody" },
  { target: "place-chat", place: "chat", more: false, title: "tourMessagesTitle", body: "tourMessagesBody" },
  { target: "place-feed", place: "feed", more: false, title: "tourFeedTitle", body: "tourFeedBody" },
  { target: "place-play", place: "play", more: false, title: "tourPlayTitle", body: "tourPlayBody" },
  { target: "place-services", place: "services", more: false, title: "tourServicesTitle", body: "tourServicesBody" },
  { target: "place-disk", place: "disk", more: true, title: "tourDiskTitle", body: "tourDiskBody" },
  { target: "place-bank", place: "bank", more: true, title: "tourBankTitle", body: "tourBankBody" },
  { target: "place-shop", place: "shop", more: true, title: "tourShopTitle", body: "tourShopBody" },
];

type Rect = { top: number; left: number; width: number; height: number };

function spotOf(name: string): Rect | null {
  const nodes = [...document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)];
  for (const node of nodes) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const box = node.getBoundingClientRect();
    if (box.width < 8 || box.height < 8) continue;
    node.scrollIntoView({ block: "nearest", inline: "nearest" });
    const next = node.getBoundingClientRect();
    return { top: next.top, left: next.left, width: next.width, height: next.height };
  }
  return null;
}

export function AppTour({
  index,
  open,
  onIndex,
  onClose,
  onPlace,
}: {
  index: number;
  open: boolean;
  onIndex: (next: number) => void;
  onClose: () => void;
  onPlace: (tab: CircleTab | null) => void;
}) {
  const lang = useLang();
  const placeRef = useRef(onPlace);
  placeRef.current = onPlace;
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = STEPS[index];

  useEffect(() => setNode(document.body), []);

  useEffect(() => {
    const current = STEPS[index];
    if (!current) return;
    document.documentElement.dataset.tour = current.more ? "more" : "on";
    placeRef.current(current.place);
    window.dispatchEvent(new CustomEvent("vv-circle-more", { detail: current.more }));
    return () => {
      delete document.documentElement.dataset.tour;
    };
  }, [index]);

  useEffect(() => {
    const current = STEPS[index];
    if (!current) return;
    let dead = false;
    const measure = () => {
      if (!dead) setRect(spotOf(current.target));
    };
    measure();
    const timers = [80, 260, 520].map((ms) => window.setTimeout(measure, ms));
    window.addEventListener("resize", measure);
    return () => {
      dead = true;
      timers.forEach((id) => window.clearTimeout(id));
      window.removeEventListener("resize", measure);
    };
  }, [index, open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        if (index >= STEPS.length - 1) onClose();
        else onIndex(index + 1);
      } else if (event.key === "ArrowLeft" && index > 0) {
        event.preventDefault();
        onIndex(index - 1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, onClose, onIndex]);

  if (!node || !step) return null;
  const pad = 8;
  const hole = rect
    ? { top: Math.max(8, rect.top - pad), left: Math.max(8, rect.left - pad), width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null;
  const cardWidth = Math.min(352, window.innerWidth - 24);
  let cardTop = hole ? hole.top + hole.height + 14 : Math.max(24, (window.innerHeight - 240) / 2);
  let cardLeft = hole ? hole.left : 12;
  if (cardTop + 230 > window.innerHeight) cardTop = Math.max(12, (hole?.top || 80) - 230);
  if (cardLeft + cardWidth > window.innerWidth - 12) cardLeft = window.innerWidth - cardWidth - 12;
  if (cardLeft < 12) cardLeft = 12;
  const last = index >= STEPS.length - 1;

  return createPortal(
    <div className="fixed inset-0 z-[95]" role="dialog" aria-modal="true" aria-label={ui(lang, "tourStart")}>
      <button type="button" className="absolute inset-0 cursor-default" aria-label={ui(lang, "tourSkip")} onClick={onClose} />
      {hole ? (
        <div
          className="pointer-events-none absolute border border-accent/70 transition-all duration-500 ease-out"
          style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height, borderRadius: 18, boxShadow: "0 0 0 9999px rgba(6,6,10,0.72)" }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-black/55" />
      )}
      <div
        className="absolute z-10 rounded-3xl border border-line bg-elev p-4 shadow-[var(--shadow)] transition-all duration-500 ease-out"
        style={{ top: cardTop, left: cardLeft, width: cardWidth }}
      >
        <p className="text-[11px] tracking-[0.16em] text-faint uppercase">{fill("{n} / {all}", { n: index + 1, all: STEPS.length })}</p>
        <h2 className="mt-1 font-serif text-2xl tracking-tight">{ui(lang, step.title)}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{ui(lang, step.body)}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" className="press h-10 px-1 text-sm text-faint" onClick={onClose}>
            {ui(lang, "tourSkip")}
          </button>
          <div className="flex gap-2">
            {index > 0 ? (
              <button type="button" className="press h-10 rounded-xl border border-line px-3 text-sm" onClick={() => onIndex(index - 1)}>
                {ui(lang, "tourBack")}
              </button>
            ) : null}
            <button
              type="button"
              className="press h-10 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg"
              onClick={() => (last ? onClose() : onIndex(index + 1))}
            >
              {last ? ui(lang, "tourDone") : ui(lang, "tourNext")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    node,
  );
}
