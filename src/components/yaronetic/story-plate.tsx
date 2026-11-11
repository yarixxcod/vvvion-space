const PAPERS = ["#f3efe6", "#f6e6d8", "#e7e4f4", "#e5eee4", "#f3e4e1"] as const;
const INK = "#1c1b19";
const LILAC = "#c4b5e8";
const DEEP = "#1b1526";
const GOLD = "#e8c98a";

function hash(seed: string) {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    value ^= seed.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function Sun({ shift }: { shift: number }) {
  const x = 34 + shift * 10;
  return (
    <g>
      <circle cx={x} cy="46" r="20" fill={GOLD} />
      <g stroke={GOLD} strokeWidth="2" strokeLinecap="round">
        <path d={`M${x} 16v7M${x} 70v7M${x - 30} 46h7M${x + 23} 46h7`} />
      </g>
      <path d="M0 88h120" stroke={INK} strokeWidth="2.5" />
      <path d="M10 98h100" stroke={INK} strokeWidth="1" opacity="0.4" />
      <circle cx="98" cy="26" r="7" fill={LILAC} />
    </g>
  );
}

function Press() {
  return (
    <g>
      <path d="M14 22h92" stroke={INK} strokeWidth="3.5" />
      <path d="M14 30h58" stroke={INK} strokeWidth="1" />
      <rect x="14" y="42" width="26" height="52" fill="none" stroke={INK} strokeWidth="1.5" />
      <rect x="46" y="42" width="26" height="52" fill="none" stroke={INK} strokeWidth="1.5" />
      <rect x="78" y="42" width="26" height="52" fill={LILAC} />
      <circle cx="91" cy="78" r="8" fill={DEEP} />
      <path d="M18 50h18M18 58h14M50 50h18M50 58h12" stroke={INK} strokeWidth="1.5" opacity="0.55" />
    </g>
  );
}

function Ridge({ shift }: { shift: number }) {
  const sun = 78 + shift * 6;
  return (
    <g>
      <path d="M0 100 L26 62 L46 80 L70 44 L120 100 Z" fill={LILAC} />
      <path d="M0 100 L38 66 L66 90 L94 52 L120 100 Z" fill={INK} />
      <circle cx={sun} cy="30" r="8" fill={GOLD} />
    </g>
  );
}

function Blocks() {
  return (
    <g>
      <rect x="12" y="50" width="18" height="58" fill={INK} />
      <rect x="34" y="30" width="18" height="78" fill={DEEP} />
      <rect x="56" y="60" width="16" height="48" fill={INK} opacity="0.72" />
      <rect x="76" y="22" width="28" height="86" fill={LILAC} />
      <rect x="82" y="34" width="6" height="8" fill={DEEP} />
      <rect x="92" y="34" width="6" height="8" fill={DEEP} />
      <rect x="82" y="50" width="6" height="8" fill={DEEP} />
      <rect x="92" y="50" width="6" height="8" fill={GOLD} />
    </g>
  );
}

function Orbit({ shift }: { shift: number }) {
  return (
    <g>
      <circle cx="60" cy="60" r="40" fill="none" stroke={INK} strokeWidth="1.4" />
      <circle cx="60" cy="60" r="24" fill="none" stroke={INK} strokeWidth="1" />
      <circle cx="60" cy="60" r="9" fill={LILAC} />
      <circle cx={88 + shift * 2} cy="34" r="5.5" fill={INK} />
      <circle cx="30" cy="86" r="3" fill={GOLD} />
      <circle cx="96" cy="84" r="2" fill={INK} />
    </g>
  );
}

function Branch() {
  return (
    <g>
      <path d="M16 104 C38 82 48 52 100 20" fill="none" stroke={INK} strokeWidth="2" />
      <ellipse cx="46" cy="74" rx="12" ry="6" fill={LILAC} transform="rotate(-28 46 74)" />
      <ellipse cx="68" cy="50" rx="14" ry="7" fill={GOLD} transform="rotate(-40 68 50)" />
      <ellipse cx="86" cy="34" rx="9" ry="5" fill={LILAC} transform="rotate(-18 86 34)" />
      <circle cx="100" cy="20" r="3.5" fill={INK} />
    </g>
  );
}

export function StoryPlate({ seed, index, wide = false }: { seed: string; index: number; wide?: boolean }) {
  const n = hash(seed || String(index));
  const paper = PAPERS[n % PAPERS.length];
  const motif = n % 6;
  const shift = n % 4;
  const label = String(index + 1).padStart(2, "0");
  return (
    <div
      className={wide ? "relative h-40 w-full overflow-hidden" : "relative w-[6.75rem] shrink-0 self-stretch overflow-hidden"}
      aria-hidden="true"
    >
      <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice">
        <rect width="120" height="120" fill={paper} />
        {motif === 0 ? <Sun shift={shift} /> : null}
        {motif === 1 ? <Press /> : null}
        {motif === 2 ? <Ridge shift={shift} /> : null}
        {motif === 3 ? <Blocks /> : null}
        {motif === 4 ? <Orbit shift={shift} /> : null}
        {motif === 5 ? <Branch /> : null}
      </svg>
      <span className="absolute bottom-2 left-2.5 font-serif text-sm tracking-tight text-[#1c1b19]/70">{label}</span>
    </div>
  );
}
