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
export type FaceMood = "idle" | "think" | "talk" | "happy" | "oops" | "look" | "wonder" | "draw" | "seek";

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
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % set.length), 1600);
    return () => window.clearInterval(timer);
  }, [kind]);
  const set = PASSING[kind] ?? PASSING.idle;
  return set[index % set.length] ?? "idle";
}

export function isFaceVariant(value: string | null | undefined): value is FaceVariant {
  return FACE_VARIANTS.some((item) => item.id === value);
}

type Shape = {
  body: "pebble" | "moon" | "square";
  ears?: boolean;
  visor?: boolean;
  cheeks?: boolean;
  blocks?: boolean;
  eye: { rx: number; ry: number };
  smile: string;
  talk: string;
  frown: string;
};

const SHAPES: Record<FaceVariant, Shape> = {
  pebble: {
    body: "pebble",
    eye: { rx: 7, ry: 8 },
    smile: "M25 43.5c3.2 4 10.8 4 14 0",
    talk: "M28 44.5h8",
    frown: "M25 47c3.2-3.4 10.8-3.4 14 0",
  },
  moon: {
    body: "moon",
    eye: { rx: 6.2, ry: 6.4 },
    smile: "M23.5 41.5c4 6 13 6 17 0",
    talk: "M26.5 43.5h11",
    frown: "M24 48c3.8-4.2 12.2-4.2 16 0",
  },
  spark: {
    body: "pebble",
    ears: true,
    eye: { rx: 6.2, ry: 7.2 },
    smile: "M26 44c2.6 3.2 9.4 3.2 12 0",
    talk: "M29 44.2h6",
    frown: "M26 46.5c2.6-2.6 9.4-2.6 12 0",
  },
  visor: {
    body: "square",
    visor: true,
    eye: { rx: 4.4, ry: 4.6 },
    smile: "M26 45h12",
    talk: "M29 45h6",
    frown: "M26 47h12",
  },
  bloom: {
    body: "moon",
    cheeks: true,
    eye: { rx: 6.6, ry: 7.4 },
    smile: "M23 42c4.2 6.4 13.8 6.4 18 0",
    talk: "M27 44h10",
    frown: "M24 48.2c3.6-3.6 12.4-3.6 16 0",
  },
  pixel: {
    body: "square",
    blocks: true,
    eye: { rx: 5.4, ry: 5.2 },
    smile: "M26 44h12",
    talk: "M29 44h6",
    frown: "M26 47h12",
  },
};

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
  const raw = useId().replace(/:/g, "");
  const shape = SHAPES[variant ?? "pebble"];
  const [ink, glow] = variant ? LOOK[variant] : palette(name);
  const lid = { rx: shape.eye.rx + 0.4, ry: shape.eye.ry + 0.4 };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className="mface shrink-0"
      data-mood={mood}
      data-face={variant ?? "pebble"}
      style={{ ["--face" as string]: ink }}
      aria-hidden
    >
      <defs>
        <linearGradient id={raw} x1="8" y1="4" x2="56" y2="60">
          <stop offset="0%" stopColor={glow} />
          <stop offset="100%" stopColor={ink} />
        </linearGradient>
      </defs>
      {shape.ears ? (
        <g fill={glow}>
          <polygon points="12,26 4,6 24,16" />
          <polygon points="52,26 60,6 40,16" />
        </g>
      ) : null}
      {shape.cheeks ? (
        <g fill={glow}>
          <circle cx="32" cy="6" r="7" />
          <circle cx="10" cy="18" r="7" />
          <circle cx="54" cy="18" r="7" />
          <circle cx="14" cy="46" r="6.5" />
          <circle cx="50" cy="46" r="6.5" />
        </g>
      ) : null}
      {shape.body === "moon" ? (
        <circle className="mface-body" cx="32" cy="33" r="24" fill={`url(#${raw})`} />
      ) : shape.body === "square" ? (
        <rect className="mface-body" x="8" y="10" width="48" height="46" rx="6" fill={`url(#${raw})`} />
      ) : (
        <rect
          className="mface-body"
          x="6"
          y={shape.ears ? 18 : 4}
          width="52"
          height={shape.ears ? 42 : 56}
          rx={shape.ears ? 16 : 22}
          fill={`url(#${raw})`}
        />
      )}
      {shape.visor ? (
        <rect x="12" y="25" width="40" height="14" rx="7" fill="#1b1524" opacity="0.28" />
      ) : null}
      {shape.blocks ? (
        <g fill={glow}>
          <rect x="14" y="16" width="6" height="6" rx="1" />
          <rect x="22" y="16" width="6" height="6" rx="1" />
        </g>
      ) : null}
      <g className="mface-look">
        <ellipse className="mface-eye" cx="24" cy="30" rx={shape.eye.rx} ry={shape.eye.ry} />
        <ellipse className="mface-eye" cx="42" cy="30" rx={shape.eye.rx} ry={shape.eye.ry} />
        <g className="mface-pupils">
          <circle cx="25.2" cy="31.2" r="3.1" />
          <circle cx="43.2" cy="31.2" r="3.1" />
        </g>
        <g className="mface-lids" fill={ink}>
          <ellipse cx="24" cy="30" rx={lid.rx} ry={lid.ry} />
          <ellipse cx="42" cy="30" rx={lid.rx} ry={lid.ry} />
        </g>
        <path className="mface-smile" d={shape.smile} />
        <path className="mface-talk" d={shape.talk} />
        <path className="mface-frown" d={shape.frown} />
      </g>
      <g className="mface-spark">
        <circle cx="54" cy="12" r="2.1" />
        <circle cx="58" cy="18" r="1.2" />
      </g>
    </svg>
  );
}
