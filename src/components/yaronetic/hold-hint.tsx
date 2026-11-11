import { useRef, useState, type ReactNode } from "react";

export function HoldHint({ text, children }: { text: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const timer = useRef(0);
  const held = useRef(false);
  const hide = useRef(0);

  function arm() {
    window.clearTimeout(timer.current);
    window.clearTimeout(hide.current);
    held.current = false;
    timer.current = window.setTimeout(() => {
      held.current = true;
      setOpen(true);
    }, 420);
  }

  function release() {
    window.clearTimeout(timer.current);
    if (!held.current) return;
    window.clearTimeout(hide.current);
    hide.current = window.setTimeout(() => setOpen(false), 1100);
  }

  return (
    <span
      className="relative inline-flex"
      onPointerDown={arm}
      onPointerUp={release}
      onPointerLeave={() => {
        window.clearTimeout(timer.current);
        setOpen(false);
      }}
      onPointerCancel={() => {
        window.clearTimeout(timer.current);
        setOpen(false);
      }}
      onContextMenu={(event) => event.preventDefault()}
      onClickCapture={(event) => {
        if (!held.current) return;
        event.preventDefault();
        event.stopPropagation();
        held.current = false;
      }}
    >
      {children}
      {open ? (
        <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-[13rem] -translate-x-1/2 rounded-xl bg-fg px-2.5 py-1.5 text-center text-xs leading-snug text-bg shadow-[var(--shadow)]">
          {text}
        </span>
      ) : null}
    </span>
  );
}
