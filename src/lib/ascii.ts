const BOX = /[─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬╭╮╯╰▀▄█░▒▓▲▼◆○●□■]/u;

function looksLikeTexLine(line: string) {
  return /\\[a-zA-Z]+|\\[!,:;/%&#$]|[_^]\{|\{[.,]\}|\$\$/.test(line);
}

function isMarkdownProse(line: string): boolean {
  if (BOX.test(line)) return false;
  const trimmed = line.trim();
  if (/[{}<>;=]/.test(trimmed) && !/\*\*[^*\n]+\*\*|__[^_\n]+__/.test(trimmed)) return false;
  if (/^\s*(?:[-*+]|\d+\.)\s+\S/u.test(line) && /\p{L}{3,}/u.test(line)) return true;
  if (/^\s{0,3}#{1,6}\s+\p{L}/u.test(line)) return true;
  if (/\*\*[^*\n]+\*\*|__[^_\n]+__/u.test(line) && /\p{L}{3,}/u.test(line)) return true;
  return false;
}

function artScore(line: string): boolean {
  if (looksLikeTexLine(line) || isMarkdownProse(line)) return false;
  const trimmed = line.trim();
  if (trimmed.length < 4) return false;
  const symbols = (line.match(/[^\p{L}\p{N}\s]/gu) || []).length;
  const wide = / {2,}|\t/.test(line);
  const ratio = symbols / trimmed.length;
  return BOX.test(line) || (wide && symbols >= 3) || (ratio >= 0.45 && symbols >= 4 && trimmed.length >= 6);
}

/** True when the text is a drawing made of characters, not a normal paragraph. */
export function looksLikeAscii(text: string): boolean {
  const lines = text.replace(/\s+$/u, "").split("\n");
  const filled = lines.filter((line) => line.trim().length > 0);
  if (filled.length < 2) return false;
  let art = 0;
  for (const line of filled) if (artScore(line)) art += 1;
  return art >= 2 && art / filled.length >= 0.45;
}

export function isAsciiLang(lang?: string): boolean {
  const key = (lang || "").toLowerCase();
  return key === "ascii" || key === "art";
}

/** A fenced block that is really a list or bold text, not a drawing or a program. */
export function looksLikeMarkdown(text: string): boolean {
  if (BOX.test(text) || looksLikeAscii(text)) return false;
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return false;
  let hit = 0;
  for (const line of lines) if (isMarkdownProse(line)) hit += 1;
  return hit >= 1 && hit / lines.length >= 0.5;
}

/** Wrap unprotected drawings in an ascii fence so Markdown keeps every space. */
export function fenceAscii(text: string): string {
  const out: string[] = [];
  let cursor = 0;
  let open = false;
  for (const match of text.matchAll(/```/g)) {
    const at = match.index ?? 0;
    if (!open) {
      out.push(fenceLoose(text.slice(cursor, at)));
      cursor = at;
      open = true;
      continue;
    }
    out.push(text.slice(cursor, at + 3));
    cursor = at + 3;
    open = false;
  }
  const rest = text.slice(cursor);
  out.push(open ? rest : fenceLoose(rest));
  return out.join("");
}

function fenceLoose(chunk: string): string {
  const lines = chunk.split("\n");
  const out: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").replace(/\n+$/u, "");
    if (buf.length >= 2 && looksLikeAscii(body)) {
      out.push("```ascii", body, "```");
    } else {
      out.push(...buf);
    }
    buf = [];
  };
  for (const line of lines) {
    const blank = line.trim() === "";
    if (artScore(line) || (buf.length > 0 && blank && buf.filter((item) => item.trim()).length < 40)) {
      if (blank && buf.length > 0 && buf[buf.length - 1]?.trim() === "") {
        flush();
        out.push(line);
        continue;
      }
      buf.push(line);
      continue;
    }
    flush();
    out.push(line);
  }
  flush();
  return out.join("\n");
}
