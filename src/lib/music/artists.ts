const ARTICLE = /^(the|a|an|le|la|el|los|las|der|die|das|dj)$/i;

function splitCommas(value: string): string[] {
  const bits = value
    .split(/\s*,\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < bits.length; i++) {
    const cur = bits[i] || "";
    const next = bits[i + 1] || "";
    const head = next.split(" ")[0] || "";
    if (cur.split(" ").length === 1 && ARTICLE.test(head)) {
      out.push(`${cur}, ${next}`);
      i += 1;
    } else out.push(cur);
  }
  return out;
}

/** One credit line into separate people. "A, B feat. C" is three names; "Tyler, The Creator" stays one. */
export function splitArtists(input: string): string[] {
  const raw = input.replace(/\s+/g, " ").trim();
  if (raw.length < 2) return [];
  const chunks = raw.split(/\s+(?:feat\.?|ft\.?|featuring|vs\.?)\s+|\s+x\s+/i);
  const people: string[] = [];
  for (const chunk of chunks) {
    for (const comma of splitCommas(chunk)) {
      for (const bit of comma.split(/\s+(?:&|\/)\s+/)) {
        const name = bit.replace(/^[\s,;/]+|[\s,;/]+$/g, "").trim();
        if (name.length >= 2) people.push(name.slice(0, 80));
      }
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of people) {
    const key = name.toLocaleLowerCase("ru");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.slice(0, 6);
}
