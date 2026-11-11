export type MathSlot = { tex: string; display: boolean; raw: string };

const FENCE = /(```[\s\S]*?```|`[^`\n]+`)/g;
const TOKEN = /@@MATH(\d+)@@/g;

function looksLikeMath(body: string) {
  const tex = body.trim();
  if (!tex || tex.length > 500) return false;
  if (/^[A-Za-z](?:_\{?[A-Za-z0-9]+\}?)?(?:\^\{?[A-Za-z0-9]+\}?)?$/.test(tex)) return true;
  return /\\[a-zA-Z]+/.test(tex) || /[\^_]/.test(tex) || /\\[!,:;/%&#$]/.test(tex) || /\{[.,]\}/.test(tex);
}

function tidy(tex: string, display: boolean) {
  const body = tex.replace(/\r\n/g, "\n").trim();
  if (!display || /\\begin\s*\{/.test(body)) return body;
  let rows = body;
  const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1 && !/\\\\/.test(body)) rows = lines.join(" \\\\\n");
  if (!/\\\\/.test(rows)) return body;
  return `\\begin{aligned}\n${rows}\n\\end{aligned}`;
}

function take(slots: MathSlot[], tex: string, display: boolean, raw: string) {
  const id = slots.length;
  slots.push({ tex: tidy(tex, display), display, raw });
  return `@@MATH${id}@@`;
}

function bare(body: string) {
  return !/[A-Za-z0-9\\]/.test(body);
}

function replaceOutside(source: string, slots: MathSlot[]) {
  let text = source.replace(/\$\$([\s\S]+?)\$\$/g, (full, body: string) => {
    if (!body.trim() || bare(body)) return full;
    return `\n\n${take(slots, body, true, full)}\n\n`;
  });
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (full, body: string) => {
    if (!body.trim() || bare(body)) return full;
    return `\n\n${take(slots, body, true, full)}\n\n`;
  });
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (full, body: string) => {
    if (!body.trim() || bare(body)) return full;
    return take(slots, body, false, full);
  });
  text = text.replace(/(^|[^$])\$(?!\$)([^\n$]{1,500}?)\$(?!\$)/g, (full, pre: string, body: string) => {
    if (!looksLikeMath(body) || bare(body)) return full;
    return `${pre}${take(slots, body, false, full)}`;
  });
  return text;
}

/** Pull TeX out of chat text so Markdown does not show it as source. Code spans stay untouched. */
export function prepareMath(source: string): { text: string; slots: MathSlot[] } {
  const slots: MathSlot[] = [];
  const parts = source.split(FENCE);
  const text = parts.map((part, index) => (index % 2 === 1 ? part : replaceOutside(part, slots))).join("");
  return { text, slots };
}

export function mathTokenPattern() {
  return TOKEN;
}
