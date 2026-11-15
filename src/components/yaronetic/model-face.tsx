import { useEffect, useId, useState } from "react";

const PALETTE: [string, string][] = [
  ["#3a3148", "#b7a4d6"],
  ["#24342c", "#8fbfa4"],
  ["#3a2e24", "#e0c091"],
  ["#3a2828", "#e0a39c"],
  ["#24303c", "#9bb4d0"],
  ["#342833", "#d7aec8"],
];

const LOOK: Record<FaceVariant, [string, string]> = {
  pebble: ["#3a3148", "#b7a4d6"],
  moon: ["#24303c", "#9bb4d0"],
  spark: ["#3a2e24", "#e0c091"],
  visor: ["#24342c", "#8fbfa4"],
  bloom: ["#342833", "#d7aec8"],
  pixel: ["#3a2828", "#e0a39c"],
};

export const FACE_VARIANTS = [
  { id: "pebble", label: "Камешек" },
  { id: "moon", label: "Луна" },
  { id: "spark", label: "Искра" },
  { id: "visor", label: "Визор" },
  { id: "bloom", label: "Бутон" },
  { id: "pixel", label: "Пиксель" },
] as const;

export type FaceVariant = (typeof FACE_VARIANTS)[number]["id"];
export type FaceMood =
  "idle" | "think" | "talk" | "happy" | "oops" | "look" | "wonder" | "draw" | "seek";

const PASSING: Record<string, FaceMood[]> = {
  idle: ["idle"],
  think: ["think", "look", "wonder", "seek"],
  talk: ["talk", "happy", "look"],
  draw: ["draw", "look", "wonder"],
  seek: ["seek", "look", "wonder", "think"],
  oops: ["oops"],
  happy: ["happy"],
};

export function usePassingMood(kind: keyof typeof PASSING): FaceMood {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const set = PASSING[kind] ?? PASSING.idle;
    setIndex(0);
    if (set.length < 2) return;
    const reduced =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.classList.contains("vv-reduce-motion") ||
      document.documentElement.classList.contains("vv-lowend");
    if (reduced) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex((value) => (value + 1) % set.length);
    }, 1600);
    return () => window.clearInterval(timer);
  }, [kind]);
  const set = PASSING[kind] ?? PASSING.idle;
  return set[index % set.length] ?? "idle";
}

export function isFaceVariant(value: string | null | undefined): value is FaceVariant {
  return FACE_VARIANTS.some((item) => item.id === value);
}

function palette(name: string): [string, string] {
  let hash = 0;
  for (const char of name || "vvvion") hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length] ?? PALETTE[0];
}

export function ModelFace({
  name,
  mood = "idle",
  size = 36,
  variant,
}: {
  name: string;
  mood?: FaceMood;
  size?: number;
  variant?: FaceVariant;
}) {
  const raw = `af-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const look = variant ?? "pebble";
  const [ink, glow] = variant ? LOOK[variant] : palette(name);
  const body =
    look === "visor" || look === "pixel"
      ? "M16 12H48Q57 12 57 22V45Q57 55 47 55H17Q7 55 7 45V22Q7 12 16 12Z"
      : look === "moon"
        ? "M33 7C48 7 57 19 55 35C53 51 41 59 26 55C12 52 6 40 9 26C12 14 19 7 33 7Z"
        : "M31 7C47 5 57 15 57 31C58 47 50 57 34 57C18 58 7 50 7 34C6 18 15 8 31 7Z";
  const mouth =
    mood === "oops"
      ? "M27 45Q32 40 37 45"
      : mood === "happy"
        ? "M25 41Q32 51 39 41Z"
        : mood === "wonder"
          ? "M30 43a2.5 3 0 1 0 5 0a2.5 3 0 1 0-5 0"
          : "M27 43Q32 47 37 43";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className="ai-face shrink-0"
      data-mood={mood}
      data-face={look}
      aria-hidden="true"
      style={{ ["--af-glow" as string]: glow }}
    >
      <defs>
        <radialGradient id={`${raw}-body`} cx="30%" cy="18%" r="90%">
          <stop stopColor={glow} />
          <stop offset=".5" stopColor={ink} />
          <stop offset="1" stopColor="#0c0917" />
        </radialGradient>
        <linearGradient id={`${raw}-rim`} x2=".8" y2="1">
          <stop stopColor="#fff" stopOpacity=".65" />
          <stop offset=".45" stopColor={glow} stopOpacity=".12" />
          <stop offset="1" stopColor={glow} stopOpacity=".6" />
        </linearGradient>
        <linearGradient id={`${raw}-glass`} x2="0" y2="1">
          <stop stopColor="#171321" />
          <stop offset="1" stopColor="#070610" />
        </linearGradient>
        <radialGradient id={`${raw}-eye`} cx="38%" cy="25%">
          <stop stopColor="white" />
          <stop offset="1" stopColor={glow} />
        </radialGradient>
        <filter id={`${raw}-soft`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>
      <ellipse
        cx="32"
        cy="57"
        rx="18"
        ry="3"
        fill={glow}
        opacity=".15"
        filter={`url(#${raw}-soft)`}
      />
      <g className="ai-face-body">
        {look === "spark" ? (
          <g fill={`url(#${raw}-body)`} stroke={glow} strokeWidth=".7">
            <path d="M11 23 8 5Q19 7 24 16Z" />
            <path d="M42 16Q47 7 58 5L54 25Z" />
            <path d="m13 17-1-7 8 6m27 0 7-6-1 8" fill={glow} opacity=".5" />
          </g>
        ) : null}
        {look === "bloom" ? (
          <g fill={glow} opacity=".65">
            <ellipse cx="32" cy="9" rx="8" ry="7" />
            <ellipse cx="11" cy="23" rx="7" ry="9" />
            <ellipse cx="53" cy="23" rx="7" ry="9" />
            <ellipse cx="13" cy="44" rx="7" ry="8" />
            <ellipse cx="51" cy="44" rx="7" ry="8" />
          </g>
        ) : null}
        <path d={body} fill={`url(#${raw}-body)`} stroke={`url(#${raw}-rim)`} strokeWidth="1.3" />
        <path
          d="M18 15Q29 8 42 14"
          stroke="white"
          strokeWidth="1.6"
          opacity=".25"
          fill="none"
          strokeLinecap="round"
        />
        {look === "moon" ? (
          <path
            d="M48 13C36 13 41 24 49 26C55 28 54 38 48 46"
            stroke={glow}
            strokeWidth="2"
            opacity=".3"
            fill="none"
          />
        ) : null}
        {look === "visor" ? (
          <>
            <path
              d="M8 27H3V38H8M56 27H61V38H56"
              stroke={glow}
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path d="M32 12V6" stroke={glow} strokeWidth="1.5" />
            <circle cx="32" cy="5" r="2" fill={glow} />
          </>
        ) : null}
        {look === "pixel" ? (
          <g fill={glow} opacity=".65">
            <rect x="14" y="16" width="4" height="3" rx=".6" />
            <rect x="20" y="16" width="4" height="3" rx=".6" />
            <path d="M45 48h4v3h-4Z" />
          </g>
        ) : null}
        <rect
          x="13"
          y="23"
          width="38"
          height="19"
          rx={look === "pixel" ? 4 : 9.5}
          fill={`url(#${raw}-glass)`}
          stroke={glow}
          strokeOpacity=".28"
          strokeWidth=".65"
        />
        <path
          d="M18 26H44"
          stroke="white"
          strokeWidth=".8"
          strokeOpacity=".15"
          strokeLinecap="round"
        />
        <g className="ai-face-look">
          <g className="ai-face-eyes">
            <rect
              x="19"
              y="27"
              width="8"
              height="10"
              rx={look === "pixel" ? 1.6 : 4}
              fill={`url(#${raw}-eye)`}
            />
            <rect
              x="37"
              y="27"
              width="8"
              height="10"
              rx={look === "pixel" ? 1.6 : 4}
              fill={`url(#${raw}-eye)`}
            />
            <g className="ai-face-pupils" fill="#15101f">
              <ellipse cx="23.6" cy="32" rx="2" ry="3" />
              <ellipse cx="41.6" cy="32" rx="2" ry="3" />
            </g>
            <g fill="white">
              <circle cx="22" cy="29" r="1.1" />
              <circle cx="40" cy="29" r="1.1" />
            </g>
          </g>
          <path
            className="ai-face-brow ai-face-brow-left"
            d="M19 21Q23 19 27 21"
            stroke={glow}
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />
          <path
            className="ai-face-brow ai-face-brow-right"
            d="M37 21Q41 19 45 21"
            stroke={glow}
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />
          <path
            className="ai-face-mouth"
            d={mouth}
            fill={mood === "happy" || mood === "wonder" ? "#160e22" : "none"}
            stroke={glow}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <ellipse
            className="ai-face-speaking"
            cx="32"
            cy="45"
            rx="3.2"
            ry="2.7"
            fill="#130e20"
            stroke={glow}
            strokeWidth="1.3"
          />
          <g className="ai-face-cheeks" fill="#efaccc" opacity=".4">
            <ellipse cx="17" cy="41" rx="3" ry="1.5" />
            <ellipse cx="47" cy="41" rx="3" ry="1.5" />
          </g>
        </g>
      </g>
      <g className="ai-face-orbit" stroke={glow} fill="none" strokeWidth=".9" opacity=".8">
        <path d="M5 17Q2 30 6 40M59 22Q62 35 57 46" />
        <circle cx="6" cy="17" r="1.6" fill={glow} />
      </g>
      <g className="ai-face-star" fill={glow}>
        <path d="m53 5 1.4 3.6L58 10l-3.6 1.4L53 15l-1.4-3.6L48 10l3.6-1.4Z" />
        <circle cx="59" cy="17" r="1.1" />
      </g>
    </svg>
  );
}
