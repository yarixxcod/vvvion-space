import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, Eye, X } from "lucide-react";
import { toast } from "sonner";
import { BackButton } from "@/components/yaronetic/back-button";
import { QuestionCard } from "@/components/yaronetic/question-card";
import { evaluate, formatCalc } from "@/lib/ai/calc";
import { prepareMath, type MathSlot } from "@/lib/ai/math";
import { parseQuestionBlock, splitQuestionText } from "@/lib/ai/question";
import { splitRich, type StepCard } from "@/lib/ai/steps";
import { fenceAscii, isAsciiLang, looksLikeAscii } from "@/lib/ascii";
import { pushBackLayer } from "@/lib/app-back";

type HL = {
  registerLanguage: (name: string, def: unknown) => void;
  getLanguage: (name: string) => unknown;
  highlight: (code: string, opts: { language: string }) => { value: string };
  highlightAuto: (code: string, langs: string[]) => { value: string };
};

let highlighter: Promise<HL> | null = null;

function loadHighlighter() {
  if (!highlighter) {
    highlighter = (async () => {
      const core = await import("highlight.js/lib/core");
      const hljs = core.default as HL;
      const mods = await Promise.all([
        import("highlight.js/lib/languages/bash"),
        import("highlight.js/lib/languages/css"),
        import("highlight.js/lib/languages/go"),
        import("highlight.js/lib/languages/javascript"),
        import("highlight.js/lib/languages/json"),
        import("highlight.js/lib/languages/markdown"),
        import("highlight.js/lib/languages/python"),
        import("highlight.js/lib/languages/rust"),
        import("highlight.js/lib/languages/sql"),
        import("highlight.js/lib/languages/typescript"),
        import("highlight.js/lib/languages/xml"),
        import("highlight.js/lib/languages/java"),
        import("highlight.js/lib/languages/c"),
        import("highlight.js/lib/languages/cpp"),
        import("highlight.js/lib/languages/yaml"),
        import("highlight.js/lib/languages/php"),
      ]);
      const pick = (mod: { default: unknown }) => mod.default;
      const [bash, css, go, javascript, json, markdownLang, python, rust, sql, typescript, xml, java, c, cpp, yaml, php] = mods;
      hljs.registerLanguage("javascript", pick(javascript));
      hljs.registerLanguage("js", pick(javascript));
      hljs.registerLanguage("jsx", pick(javascript));
      hljs.registerLanguage("typescript", pick(typescript));
      hljs.registerLanguage("ts", pick(typescript));
      hljs.registerLanguage("tsx", pick(typescript));
      hljs.registerLanguage("python", pick(python));
      hljs.registerLanguage("py", pick(python));
      hljs.registerLanguage("bash", pick(bash));
      hljs.registerLanguage("sh", pick(bash));
      hljs.registerLanguage("shell", pick(bash));
      hljs.registerLanguage("json", pick(json));
      hljs.registerLanguage("css", pick(css));
      hljs.registerLanguage("html", pick(xml));
      hljs.registerLanguage("xml", pick(xml));
      hljs.registerLanguage("sql", pick(sql));
      hljs.registerLanguage("go", pick(go));
      hljs.registerLanguage("rust", pick(rust));
      hljs.registerLanguage("markdown", pick(markdownLang));
      hljs.registerLanguage("md", pick(markdownLang));
      hljs.registerLanguage("java", pick(java));
      hljs.registerLanguage("c", pick(c));
      hljs.registerLanguage("cpp", pick(cpp));
      hljs.registerLanguage("hpp", pick(cpp));
      hljs.registerLanguage("yaml", pick(yaml));
      hljs.registerLanguage("yml", pick(yaml));
      hljs.registerLanguage("php", pick(php));
      return hljs;
    })();
  }
  return highlighter;
}

function sanitizeHighlight(value: string) {
  return value.replace(/<[^>]*>/g, (tag) => (/^<\/?span(?:\s+class="[a-zA-Z0-9_\- ]*")?\s*>$/.test(tag) ? tag : escapeHtml(tag)));
}

async function highlight(code: string, lang?: string) {
  if (code.length > 40_000) return escapeHtml(code);
  const hljs = await loadHighlighter();
  if (!lang || lang === "text" || lang === "txt" || lang === "plaintext") {
    if (lang) return escapeHtml(code);
    return sanitizeHighlight(hljs.highlightAuto(code, ["typescript", "javascript", "python", "bash", "json", "css", "xml", "sql", "go", "rust", "java", "cpp", "yaml", "php", "markdown"]).value);
  }
  if (hljs.getLanguage(lang)) return sanitizeHighlight(hljs.highlight(code, { language: lang }).value);
  return escapeHtml(code);
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "\u0026amp;").replaceAll("<", "\u0026lt;").replaceAll(">", "\u0026gt;").replaceAll('"', "\u0026quot;");
}

function nodeText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(nodeText).join("");
  if (value && typeof value === "object" && "props" in value) {
    const props = (value as { props?: { children?: ReactNode } }).props;
    return nodeText(props?.children);
  }
  return "";
}

function languageLabel(lang?: string) {
  const key = (lang || "").toLowerCase();
  const names: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TSX",
    typescript: "TypeScript",
    js: "JavaScript",
    jsx: "JSX",
    javascript: "JavaScript",
    py: "Python",
    python: "Python",
    bash: "Bash",
    sh: "Shell",
    shell: "Shell",
    json: "JSON",
    css: "CSS",
    html: "HTML",
    xml: "XML",
    sql: "SQL",
    go: "Go",
    rust: "Rust",
    java: "Java",
    c: "C",
    cpp: "C++",
    hpp: "C++",
    yaml: "YAML",
    yml: "YAML",
    php: "PHP",
    md: "Markdown",
    markdown: "Markdown",
  };
  return names[key] || (key ? key : "код");
}

export async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      toast("Скопировано");
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (!ok) throw new Error("copy");
    toast("Скопировано");
    return true;
  } catch {
    toast.error("Не удалось скопировать");
    return false;
  }
}

function previewDoc(code: string) {
  if (/<html[\s>]/i.test(code) || /<!doctype/i.test(code)) return code;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${code}</body></html>`;
}

function isHtmlBlock(lang: string | undefined, code: string) {
  const key = (lang || "").toLowerCase();
  if (key === "html" || key === "htm" || key === "svg") return true;
  return !key && /^\s*(<!doctype html|<html|<svg)/i.test(code);
}

function AsciiBlock({ code }: { code: string }) {
  return <pre className="ascii-art">{code.replace(/\n$/, "")}</pre>;
}

function CodeBlock({ code, lang, live }: { code: string; lang?: string; live?: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [wrap, setWrap] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches);
  const [full, setFull] = useState(false);
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const preview = isHtmlBlock(lang, code);
  useEffect(() => {
    if (!live) return;
    setPreviewCode(null);
    setFull(false);
  }, [live]);
  useEffect(() => {
    if (live) {
      setHtml(null);
      return;
    }
    let alive = true;
    void highlight(code, lang).then((value) => {
      if (alive) setHtml(value);
    });
    return () => {
      alive = false;
    };
  }, [code, lang, live]);
  useEffect(() => {
    if (!full) return;
    return pushBackLayer(() => setFull(false));
  }, [full]);
  useEffect(() => {
    if (!full) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setFull(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [full]);
  const showPreview = Boolean(preview && previewCode && !live);
  const lines = code.replace(/\n$/, "").split("\n");
  const label = languageLabel(lang);
  const doc = useMemo(() => (showPreview || full ? previewDoc(previewCode || code) : ""), [showPreview, full, previewCode, code]);
  return (
    <div className="code-frame">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-3 py-1.5 text-xs text-faint">
        <span className="font-mono tracking-wide">{label}</span>
        <span className="ml-auto flex flex-wrap items-center justify-end gap-1">
          {preview ? (
            <button
              type="button"
              className="press inline-flex h-10 items-center gap-1 rounded-lg px-2 text-muted hover:bg-subtle hover:text-fg disabled:opacity-40"
              disabled={Boolean(live)}
              onClick={() => setPreviewCode((current) => (current ? null : code))}
            >
              <Eye className="size-3.5" />
              {showPreview ? "Код" : "Просмотр"}
            </button>
          ) : null}
          <button type="button" className="press inline-flex h-10 items-center rounded-lg px-2 text-muted hover:bg-subtle hover:text-fg" onClick={() => setWrap((value) => !value)}>
            {wrap ? "В строку" : "Перенос"}
          </button>
          <button
            type="button"
            className="press inline-flex h-10 items-center gap-1 rounded-lg px-2 text-muted hover:bg-subtle hover:text-fg"
            onClick={() => {
              void copyText(code).then((ok) => {
                if (!ok) return;
                setDone(true);
                window.setTimeout(() => setDone(false), 1200);
              });
            }}
          >
            {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {done ? "Скопировано" : "Копировать"}
          </button>
        </span>
      </div>
      {showPreview ? (
        <div className="bg-white">
          <iframe title="Просмотр HTML" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={doc} className="html-preview h-[28rem] w-full bg-white" />
          <div className="flex justify-end border-t border-line bg-elev px-2 py-1.5">
            <button type="button" className="press h-10 rounded-lg px-2 text-xs text-muted" onClick={() => setFull(true)}>
              На весь экран
            </button>
          </div>
        </div>
      ) : (
        <div className={wrap ? "overflow-x-hidden" : "scroll-x"}>
          <div className="flex min-w-full">
            {wrap ? null : (
              <div className="code-gutter select-none" aria-hidden="true">
                {lines.map((_, index) => (
                  <span key={index}>{index + 1}</span>
                ))}
              </div>
            )}
            <pre className={wrap ? "code-lines code-wrap" : "code-lines"}>
              <code>{html == null ? code : <span dangerouslySetInnerHTML={{ __html: html }} />}</code>
            </pre>
          </div>
        </div>
      )}
      {full && previewCode && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[80] flex flex-col bg-black/80 p-3" role="dialog" aria-modal="true" aria-label="Просмотр HTML">
              <div className="mb-2 flex items-center justify-between">
                <BackButton onClick={() => setFull(false)} label="Назад" className="text-white" />
                <button type="button" className="press hidden h-11 items-center gap-1.5 rounded-2xl bg-elev px-3 text-sm md:inline-flex" onClick={() => setFull(false)}>
                  <X className="size-4" />
                  Закрыть
                </button>
              </div>
              <iframe title="Просмотр HTML на весь экран" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={previewDoc(previewCode)} className="html-preview min-h-0 w-full flex-1 rounded-2xl bg-white" />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function markdownComponents(live: boolean | undefined, slots: MathSlot[]): Components {
  return {
    pre: ({ children }) => <>{children}</>,
    span({ className, children }) {
      const name = Array.isArray(className) ? className.join(" ") : className || "";
      const index = /math-i-(\d+)/.exec(name);
      if (index) {
        const slot = slots[Number(index[1])];
        if (slot) return <MathView tex={slot.tex} display={slot.display} raw={slot.raw} />;
      }
      return <span className={name}>{children}</span>;
    },
    code({ className, children }) {
      const raw = nodeText(children).replace(/\n$/, "");
      const lang = /language-([\w#+.-]+)/.exec(className || "")?.[1];
      if (!(lang || raw.includes("\n"))) return <code>{raw}</code>;
      if (lang === "calc") return <CalcBlock code={raw} />;
      if (isHtmlBlock(lang, raw)) return <CodeBlock code={raw} lang={lang || "html"} live={live} />;
      if (isAsciiLang(lang) || (!lang && looksLikeAscii(raw))) return <AsciiBlock code={raw} />;
      return <CodeBlock code={raw} lang={lang} live={live} />;
    },
    a({ href, children }) {
      return (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      );
    },
    table({ children }) {
      return (
        <div className="scroll-x my-3 rounded-xl border border-line">
          <table className="w-max min-w-full border-collapse text-left text-sm">{children}</table>
        </div>
      );
    },
  };
}

function remarkMathTokens() {
  return (tree: unknown) => {
    walkMath(tree);
  };
}

type MdNode = { type?: string; value?: string; children?: MdNode[]; data?: { hName: string; hProperties: { className: string } } };

function walkMath(node: unknown) {
  if (!node || typeof node !== "object" || !("children" in node)) return;
  const children = (node as { children?: MdNode[] }).children;
  if (!children) return;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (!child) continue;
    if (child.type === "text" && typeof child.value === "string" && child.value.includes("@@MATH")) {
      const pieces: MdNode[] = [];
      let last = 0;
      for (const match of child.value.matchAll(/@@MATH(\d+)@@/g)) {
        const at = match.index ?? 0;
        if (at > last) pieces.push({ type: "text", value: child.value.slice(last, at) });
        pieces.push({ type: "mathToken", data: { hName: "span", hProperties: { className: `math-slot math-i-${match[1]}` } } });
        last = at + match[0].length;
      }
      if (last < child.value.length) pieces.push({ type: "text", value: child.value.slice(last) });
      children.splice(i, 1, ...pieces);
      i += pieces.length - 1;
      continue;
    }
    walkMath(child);
  }
}

function MathView({ tex, display, raw }: { tex: string; display: boolean; raw: string }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    if (!/[A-Za-z0-9\\]/.test(tex)) return;
    let live = true;
    void import("katex/dist/katex.min.css");
    void import("katex").then((mod) => {
      if (!live) return;
      try {
        setHtml(mod.default.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore", output: "html" }));
      } catch {
        setHtml("");
      }
    });
    return () => {
      live = false;
    };
  }, [tex, display]);
  if (!/[A-Za-z0-9\\]/.test(tex) || !html) return <span>{raw}</span>;
  return <span className={display ? "math-display" : "math-inline"} dangerouslySetInnerHTML={{ __html: html }} />;
}

function useStreamText(text: string, live?: boolean) {
  const latest = useRef(text);
  latest.current = text;
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (!live) return;
    setShown(latest.current);
    const id = window.setInterval(() => {
      setShown((current) => (current === latest.current ? current : latest.current));
    }, 80);
    return () => window.clearInterval(id);
  }, [live]);
  return live ? shown : text;
}

function AskView({
  raw,
  closed,
  live,
  interactive,
  note,
  onSubmit,
}: {
  raw: string;
  closed: boolean;
  live?: boolean;
  interactive?: boolean;
  note?: string;
  onSubmit?: (text: string) => void;
}) {
  const block = useMemo(() => parseQuestionBlock(raw), [raw]);
  useEffect(() => {
    if (!block && !(live && !closed)) console.warn("[vvvion-question] invalid");
  }, [block, live, closed]);
  if (!block) {
    if (live && !closed) {
      return (
        <div className="my-3 rounded-2xl border border-line bg-elev px-3 py-3">
          <p className="text-sm text-muted">Готовлю вопрос…</p>
        </div>
      );
    }
    return <CodeBlock code={raw} lang="json" />;
  }
  return (
    <QuestionCard
      block={block}
      live={Boolean(live)}
      interactive={Boolean(interactive) && !live}
      answered={Boolean(note) && !live}
      note={note?.slice(0, 300)}
      onSubmit={onSubmit}
    />
  );
}

export function Markdown({
  text,
  live = false,
  askable = false,
  askNote,
  onAsk,
}: {
  text: string;
  live?: boolean;
  askable?: boolean;
  askNote?: string;
  onAsk?: (text: string) => void;
}) {
  const shown = useStreamText(text, live);
  const parts = useMemo(() => splitQuestionText(shown), [shown]);
  let askSeen = false;
  return (
    <div className="prose-y">
      {parts.map((part, index) => {
        if (part.kind === "ask") {
          const first = !askSeen;
          askSeen = true;
          return (
            <AskView
              key={`q-${index}`}
              raw={part.raw}
              closed={part.closed}
              live={live}
              interactive={askable && first}
              note={askNote}
              onSubmit={onAsk}
            />
          );
        }
        return splitRich(part.text).map((piece, inner) =>
          piece.kind === "steps" ? (
            <StepList key={`${index}-s-${inner}`} steps={piece.steps} live={live} />
          ) : (
            <SettledMarkdown key={`${index}-m-${inner}`} text={piece.text} live={live} />
          ),
        );
      })}
    </div>
  );
}

function SettledMarkdown({ text, live }: { text: string; live?: boolean }) {
  if (!live) return <MarkdownBody text={text} />;
  const at = text.lastIndexOf("\n\n");
  if (at < 24) return <MarkdownBody text={text} live />;
  const tail = text.slice(at + 2);
  return (
    <>
      <MarkdownBody text={text.slice(0, at)} />
      {tail ? <MarkdownBody text={tail} live /> : null}
    </>
  );
}

const MarkdownBody = memo(function MarkdownBody({ text, live }: { text: string; live?: boolean }) {
  const prepared = useMemo(() => {
    const math = prepareMath(text);
    return { text: fenceAscii(math.text), slots: math.slots };
  }, [text]);
  const components = useMemo(() => markdownComponents(live, prepared.slots), [live, prepared.slots]);
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMathTokens]} components={components}>
      {prepared.text}
    </ReactMarkdown>
  );
});

function StepList({ steps, live }: { steps: StepCard[]; live?: boolean }) {
  return (
    <ol className="step-list">
      {steps.map((step, index) => (
        <li key={index} className="step-card">
          <div className="step-head">
            <span className="step-index">{index + 1}</span>
            <span className="min-w-0">
              <span className="step-title">{step.title || `Шаг ${index + 1}`}</span>
              {step.subtitle ? <span className="step-sub">{step.subtitle}</span> : null}
            </span>
          </div>
          {step.body ? <MarkdownBody text={step.body} live={live && index === steps.length - 1} /> : null}
        </li>
      ))}
    </ol>
  );
}

function CalcBlock({ code }: { code: string }) {
  const lines = code.split("\n").map((line) => line.trim()).filter(Boolean);
  return (
    <div className="calc-card">
      {lines.map((line) => {
        const value = evaluate(line);
        return (
          <p key={line} className="calc-line">
            <span>{line}</span>
            <span className="calc-value">{value == null ? "не посчиталось" : formatCalc(value)}</span>
          </p>
        );
      })}
    </div>
  );
}
