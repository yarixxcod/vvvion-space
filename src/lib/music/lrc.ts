export type LrcWord = { at: number; text: string };

export type LrcLine = { at: number; text: string; words?: LrcWord[] };

function stamp(min: string, sec: string): number {
  return Number(min) * 60 + Number(sec);
}

function wordsOf(body: string): { text: string; words?: LrcWord[] } {
  const words: LrcWord[] = [];
  const re = /<(\d+):(\d+(?:\.\d+)?)>([^<]*)/g;
  let found = false;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    found = true;
    const text = match[3]?.replace(/\s+/g, " ").trim() ?? "";
    const at = stamp(match[1] ?? "0", match[2] ?? "0");
    if (text && Number.isFinite(at)) words.push({ at, text });
  }
  if (!found) return { text: body.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() };
  return { text: words.map((word) => word.text).join(" "), words: words.length ? words : undefined };
}

export function parseLrc(source: string): LrcLine[] {
  const lines: LrcLine[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const times = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!times.length) continue;
    const body = wordsOf(raw.replace(/\[[^\]]+\]/g, ""));
    if (!body.text) continue;
    for (const match of times) {
      const at = stamp(match[1] ?? "0", match[2] ?? "0");
      if (Number.isFinite(at)) lines.push({ at, text: body.text, words: body.words });
    }
  }
  lines.sort((a, b) => a.at - b.at);
  return lines;
}
