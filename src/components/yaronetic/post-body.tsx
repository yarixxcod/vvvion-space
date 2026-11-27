import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { postLooksRich, renderPostHtml } from "@/lib/social/post-rich";
import { cn } from "@/lib/utils";

export function PostBody({ text }: { text: string }) {
  const rich = postLooksRich(text);
  const html = useMemo(() => (rich ? renderPostHtml(text) : ""), [text, rich]);
  const frame = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);

  useLayoutEffect(() => {
    const node = frame.current;
    if (!node || open) return;
    const measure = () => setOver(node.scrollHeight > node.clientHeight + 8);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    node.addEventListener("load", measure, true);
    return () => {
      observer.disconnect();
      node.removeEventListener("load", measure, true);
    };
  }, [text, open, rich]);

  return (
    <div className="post-rich mt-1 max-w-[68ch]">
      <div ref={frame} className={cn("post-content", !open && "post-content-clip")}>
        {rich ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="whitespace-pre-wrap text-base leading-6 text-pretty">{text}</p>
        )}
      </div>
      {over || open ? (
        <button
          type="button"
          className="press mt-1 h-11 px-1 text-sm text-accent"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Свернуть" : "Читать далее"}
        </button>
      ) : null}
    </div>
  );
}
