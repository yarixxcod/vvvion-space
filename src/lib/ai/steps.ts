export type StepCard = {
  title: string;
  subtitle: string;
  body: string;
};

export type RichPart = { kind: "md"; text: string } | { kind: "steps"; steps: StepCard[] };

function decode(value: string) {
  return value
    .replace(/"/g, '"')
    .replace(/&#39;|'/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/&/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function readTag(text: string, start: number): { raw: string; end: number } | null {
  let quote = "";
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") return { raw: text.slice(start, i), end: i + 1 };
  }
  return null;
}

function attrs(raw: string) {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_:][\w:-]*)\s*=\s*"([^"]*)"|([A-Za-z_:][\w:-]*)\s*=\s*'([^']*)'/g;
  for (const match of raw.matchAll(re)) {
    const key = (match[1] || match[3] || "").toLowerCase();
    const value = decode(match[2] ?? match[4] ?? "");
    if (key) out[key] = value;
  }
  return out;
}

function readSteps(source: string, allowOpen: boolean): { steps: StepCard[]; consumed: number } {
  const steps: StepCard[] = [];
  let i = 0;
  while (i < source.length) {
    const gap = source.slice(i);
    const rel = gap.search(/<Step\b/i);
    if (rel < 0) break;
    const between = gap.slice(0, rel);
    if (steps.length > 0 && between.replace(/```|ascii|xml|html|\s/gi, "").length > 0) break;
    const at = i + rel;
    const tag = readTag(source, at);
    if (!tag) break;
    const rest = source.slice(tag.end);
    const close = rest.search(/<\/Step>/i);
    const openTail = close < 0;
    if (openTail && !allowOpen) break;
    const body = (openTail ? rest : rest.slice(0, close)).replace(/^\s+|\s+$/g, "");
    const fields = attrs(tag.raw);
    const title = fields.title || fields.name || "";
    const subtitle = fields.subtitle || fields.time || fields.note || "";
    if (title || subtitle || body) steps.push({ title, subtitle, body });
    if (openTail) return { steps, consumed: source.length };
    i = tag.end + close + "</Step>".length;
  }
  return { steps, consumed: steps.length ? i : 0 };
}

function unwrap(text: string) {
  return text
    .replace(/```(?:ascii|xml|html|markdown|md)?[ \t]*\r?\n?(?=<Step\b|<Sequence\b)/gi, "")
    .replace(/<\/Sequence>[ \t]*```/gi, "</Sequence>");
}

function pushMd(parts: RichPart[], text: string) {
  const clean = text.replace(/^\s+|\s+$/g, "");
  if (!clean) return;
  const last = parts[parts.length - 1];
  if (last?.kind === "md") last.text = `${last.text}\n\n${clean}`;
  else parts.push({ kind: "md", text: clean });
}

/** Turn Gemini-style <Sequence><Step> blocks into cards. Other text stays Markdown. */
export function splitRich(input: string): RichPart[] {
  const text = unwrap(input);
  const parts: RichPart[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const slice = text.slice(cursor);
    const at = slice.search(/<Sequence\b|<Step\b/i);
    if (at < 0) {
      pushMd(parts, slice);
      break;
    }
    pushMd(parts, slice.slice(0, at));
    const from = cursor + at;
    const head = text.slice(from, from + 10).toLowerCase();
    if (head.startsWith("<sequence")) {
      const open = readTag(text, from);
      if (!open) break;
      const closeAt = text.toLowerCase().indexOf("</sequence>", open.end);
      const innerEnd = closeAt < 0 ? text.length : closeAt;
      const parsed = readSteps(text.slice(open.end, innerEnd), closeAt < 0);
      if (parsed.steps.length) parts.push({ kind: "steps", steps: parsed.steps });
      cursor = closeAt < 0 ? text.length : closeAt + "</sequence>".length;
      continue;
    }
    const parsed = readSteps(text.slice(from), true);
    if (!parsed.steps.length) {
      pushMd(parts, text.slice(from));
      break;
    }
    parts.push({ kind: "steps", steps: parsed.steps });
    cursor = from + parsed.consumed;
  }
  return parts.length ? parts : [{ kind: "md", text: input }];
}
