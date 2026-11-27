import { useLayoutEffect, useRef, useState } from "react";
import { postLooksRich, renderPostHtml } from "@/lib/social/post-rich";
import { cn } from "@/lib/utils";

export function PostBody({ text }: { text: string }) {
  const rich = postLooksRich(text);
  const frame = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);

  useLayoutEffect(() => {
    const node = frame.current;
    if (!node || open) return;
    setOver(node.scrollHeight > node.clientHeight + 8);
  }, [text, open, rich]);

  return (
    <div className="post-rich mt-1 max-w-[68ch]">
      <div ref={frame} className={cn("post-content", !open && "post-content-clip")}>
        {rich ? (
          <div dangerouslySetInnerHTML={{ __html: renderPostHtml(text) }} />
        ) : (
          <p className="whitespace-pre-wrap text-base leading-6 text-pretty">{text}</p>
        )}
      </div>
      {over || open ? (
        <button type="button" className="press mt-1 h-11 px-1 text-sm text-accent" onClick={() => setOpen((value) => !value)}>
          {open ? "Свернуть" : "Развернуть"}
        </button>
      ) : null}
    </div>
  );
}
