/** Block boundaries outside fences. Retain loose lists and blockquotes as one block. */
export function markdownChunks(text: string): string[] {
  // Reference definitions affect earlier paragraphs: keep that uncommon case intact.
  if (/^ {0,3}\[[^\]]+\]:/m.test(text)) return [text];
  const lines = text.match(/[^\n]*(?:\n|$)/g) || [];
  const chunks: string[] = [];
  let buffer = "",
    fence = "",
    count = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*?)(?:\n)?$/.exec(line);
    if (marker) {
      if (!fence) {
        fence = marker[1][0];
        count = marker[1].length;
      } else if (marker[1][0] === fence && marker[1].length >= count && !marker[2].trim())
        fence = "";
    }
    if (!fence && !line.trim() && buffer.trim()) {
      const next = lines.slice(i + 1).find((l) => l.trim()) || "";
      const list = /(?:^|\n) {0,3}(?:[-+*]|\d+[.)])\s/.test(buffer);
      const continues =
        (list && /^(?: {0,3}(?:[-+*]|\d+[.)])\s| {2,}|\t)/.test(next)) ||
        (/^ {0,3}>/m.test(buffer) && /^ {0,3}>/.test(next));
      if (next.trim() && !continues) {
        chunks.push(buffer.trimEnd());
        buffer = "";
        continue;
      }
    }
    buffer += line;
  }
  if (buffer.trim()) chunks.push(buffer);
  return chunks.length ? chunks : [""];
}
function inlineTail(text: string): string {
  let code = "", out = "";
  const stack: string[] = [];
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length) {
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === "`") {
      const run = /^`+/.exec(text.slice(i))![0];
      if (!code) {
        if (i + run.length === text.length) break;
        code = run;
      } else if (run === code) code = "";
      out += run;
      i += run.length;
      continue;
    }
    if (!code && (ch === "*" || ch === "_" || ch === "~")) {
      const marker = text.slice(i, i + 2) === ch + ch ? ch + ch : ch;
      if (marker === "~") {
        out += ch;
        i++;
        continue;
      }
      const before = text[i - 1] || "",
        after = text[i + marker.length] || "";
      if (ch === "_" && /[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after)) {
        out += marker;
        i += marker.length;
        continue;
      }
      const top = stack.at(-1);
      if (top === marker && before && !/\s/.test(before)) stack.pop();
      else if (!after) {
        if (!before || /\s/.test(before) || top === marker + marker) break;
      } else if (!/\s/.test(after)) stack.push(marker);
      out += marker;
      i += marker.length;
      continue;
    }
    out += ch;
    i++;
  }
  return out + (code || stack.reverse().join(""));
}
/** Only the growing tail is normalized; saved messages and copied code stay untouched. */
export function stabilizeMarkdown(text: string): string {
  const lines = text.split("\n");
  let fence = "",
    count = 0,
    start = -1;
  for (let i = 0; i < lines.length; i++) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!marker) continue;
    if (!fence) {
      if (i === lines.length - 1) return lines.slice(0, i).join("\n");
      fence = marker[1][0];
      count = marker[1].length;
      start = i;
    } else if (marker[1][0] === fence && marker[1].length >= count && !marker[2].trim()) {
      fence = "";
      start = -1;
    }
  }
  if (fence) {
    const last = lines.at(-1) || "";
    if (new RegExp("^ {0,3}" + (fence === "`" ? "`" : "~") + "{1," + (count - 1) + "}$").test(last))
      lines.pop();
    return lines.join("\n") + "\n" + fence.repeat(count);
  }
  const last = lines.at(-1) || "";
  if (/^ {0,3}(?:#{1,6}|[-+*]|\d+[.)])\s*$/.test(last)) lines.pop();
  const joined = lines.join("\n");
  // Wait for a GFM divider before revealing a pending table header.
  if (/^\s*\|/.test(joined) && !/^\s*\|?\s*:?-{3,}.*\|/m.test(joined)) return "";
  // Inline completion must not change literal contents of already closed fences.
  if (start < 0 && /^(?: {0,3})(?:`{3,}|~{3,})/m.test(joined)) return joined;
  return inlineTail(joined);
}
