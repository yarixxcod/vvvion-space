import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import sanitizeHtml, { type Attributes } from "sanitize-html";

/** Wall posts keep their source. This is the maximum stored length. */
export const POST_SOURCE_MAX = 20_000;

const TAGS = [
  "div", "span", "p", "h1", "h2", "h3", "h4", "b", "i", "u", "s", "strong", "em", "mark", "small", "sub", "sup",
  "br", "hr", "ul", "ol", "li", "blockquote", "pre", "code", "table", "thead", "tbody", "tr", "th", "td",
  "img", "a", "details", "summary", "figure", "figcaption", "del",
];

const STYLE_PROPS = [
  "color", "background", "background-color", "background-image",
  "border", "border-radius", "border-color", "border-width", "border-style",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "text-align", "font-size", "font-weight", "font-style", "letter-spacing", "line-height",
  "display", "gap", "row-gap", "column-gap",
  "flex", "flex-direction", "flex-wrap", "flex-flow", "flex-grow", "flex-shrink", "flex-basis",
  "align-items", "align-content", "justify-content", "justify-items",
  "grid", "grid-template-columns", "grid-template-rows", "grid-column", "grid-row", "grid-gap",
  "width", "max-width", "opacity", "box-shadow",
];

/** Whole value, no url()/expression/javascript, no markup breakout, no overlay. */
const SAFE_STYLE =
  /^(?![\s\S]*url\s*\()(?![\s\S]*expression\s*\()(?![\s\S]*javascript:)(?![\s\S]*vbscript:)(?![\s\S]*@import)(?![\s\S]*-moz-binding)(?![\s\S]*!important)(?![\s\S]*\b(?:fixed|absolute|sticky)\b)(?![\s\S]*[<>{}])[\s\S]{1,240}$/i;

const STYLE_RULES: Record<string, RegExp[]> = {};
for (const prop of STYLE_PROPS) STYLE_RULES[prop] = [SAFE_STYLE];

function safeClass(value: string): string {
  const kept = value
    .split(/\s+/)
    .filter((name) => {
      if (!name || name.length > 48) return false;
      if (!/^[a-zA-Z0-9_:[\]/-]+$/.test(name)) return false;
      const bare = name.replace(/^!/, "").replace(/^(?:sm|md|lg|xl|2xl):/, "");
      return !/^(?:fixed|absolute|sticky|inset(?:-|$)|z-|top-|right-|bottom-|left-|translate|transform)/.test(bare);
    })
    .slice(0, 24);
  return kept.join(" ");
}

function safeLink(href: string): string {
  const value = href.trim();
  if (/[\u0000-\u0020]/.test(value)) return "";
  if (/^(?:javascript|data|vbscript):/i.test(value)) return "";
  if (/^https?:\/\//i.test(value) || /^mailto:/i.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return "";
}

function transformAnchor(_tag: string, attribs: Attributes) {
  const href = safeLink(attribs.href || "");
  const next: Attributes = { rel: "noopener noreferrer nofollow", target: "_blank" };
  if (href) next.href = href;
  if (attribs.title) next.title = attribs.title;
  const className = attribs.class ? safeClass(attribs.class) : "";
  if (className) next.class = className;
  if (attribs.style) next.style = attribs.style;
  return { tagName: "a", attribs: next };
}

function transformImage(_tag: string, attribs: Attributes) {
  const src = (attribs.src || "").trim();
  if (!/^https:\/\/\S+$/i.test(src)) return { tagName: "span", attribs: {} as Attributes, text: attribs.alt || "" };
  const next: Attributes = { src, loading: "lazy", alt: attribs.alt || "" };
  if (attribs.title) next.title = attribs.title;
  const className = attribs.class ? safeClass(attribs.class) : "";
  if (className) next.class = className;
  if (attribs.style) next.style = attribs.style;
  return { tagName: "img", attribs: next };
}

function transformInput(_tag: string, attribs: Attributes) {
  if (String(attribs.type || "").toLowerCase() !== "checkbox") return { tagName: "span", attribs: {} as Attributes, text: "" };
  const on = attribs.checked !== undefined && attribs.checked !== "false";
  return { tagName: "span", attribs: { class: "post-check" } as Attributes, text: on ? "☑" : "☐" };
}

const SANITIZE = {
  allowedTags: TAGS,
  allowedAttributes: {
    "*": ["class", "style", "title"],
    a: ["href", "rel", "target", "title", "class", "style"],
    img: ["src", "alt", "title", "loading", "class", "style"],
    td: ["colspan", "rowspan", "class", "style", "title"],
    th: ["colspan", "rowspan", "class", "style", "title"],
    details: ["open", "class", "style", "title"],
  },
  allowedStyles: { "*": STYLE_RULES },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard" as const,
  nestingLimit: 40,
  transformTags: {
    a: transformAnchor,
    img: transformImage,
    input: transformInput,
    del: (_tag: string, attribs: Attributes) => ({ tagName: "s", attribs }),
  },
};

function cleanClassAttributes(html: string): string {
  return html.replace(/\sclass="([^"]*)"/g, (_all, value: string) => {
    const next = safeClass(value);
    return next ? ` class="${next}"` : "";
  });
}

/** Strip dangerous HTML but keep markdown source and allowed markup. */
export function sanitizePostHtml(dirty: string): string {
  return cleanClassAttributes(sanitizeHtml(dirty, SANITIZE));
}

let markdown: { processSync: (source: string) => unknown } | null = null;

function markdownToHtml(source: string): string {
  if (!markdown) {
    markdown = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRaw)
      .use(rehypeStringify);
  }
  return String(markdown.processSync(source));
}

/** Render stored source to safe HTML. Call this on the client too. */
export function renderPostHtml(source: string): string {
  try {
    return sanitizePostHtml(markdownToHtml(source));
  } catch {
    return sanitizePostHtml(source.replace(/[&<>]/g, (char) => (char === "&" ? "\u0026amp;" : char === "<" ? "\u0026lt;" : "\u0026gt;")));
  }
}

/** True when the source asks for markdown or HTML. Plain posts stay pre-wrapped. */
export function postLooksRich(source: string): boolean {
  if (/<\/?[a-z][^>\n]{0,80}>/i.test(source)) return true;
  if (/^#{1,6}\s+\S/m.test(source)) return true;
  if (/```/.test(source)) return true;
  if (/^\s{0,3}>\s+\S/m.test(source)) return true;
  if (/^\s{0,3}(?:[-*+]|\d+\.)\s+\S/m.test(source)) return true;
  if (/!\[[^\]]*]\([^)\s]+\)/.test(source)) return true;
  if (/\[[^\]]+]\((?:https?:|mailto:)[^)\s]+\)/i.test(source)) return true;
  if (/~~[^~\n]+~~/.test(source)) return true;
  if (/\*\*[^*\n]+\*\*|__[^_\n]+__/.test(source)) return true;
  if (/^\s*\|.+\|/m.test(source) && /^\s*\|?\s*:?-{3,}/m.test(source)) return true;
  if (/^\s*[-*+]\s+\[[ xX]]/m.test(source)) return true;
  return false;
}

export function preparePostSource(raw: string): { text: string; error?: string } {
  const text = raw.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim();
  if (!text) return { text: "" };
  if (text.length > POST_SOURCE_MAX) return { text: "", error: "Не больше 20000 символов" };
  const withoutBadLinks = text
    .replace(/!\[[^\]]*]\(\s*(?:javascript:|data:|vbscript:)(?:[^()]|\([^()]*\))*\)/gi, "")
    .replace(/\[([^\]]*)]\(\s*(?:javascript:|data:|vbscript:)(?:[^()]|\([^()]*\))*\)/gi, "$1");
  return { text: sanitizePostHtml(withoutBadLinks) };
}
