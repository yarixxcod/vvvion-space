function reactHandler(el: Element, name: string): ((event: unknown) => void) | undefined {
  const key = Object.keys(el).find((item) => item.startsWith("__reactProps$"));
  if (!key) return undefined;
  const props = (el as unknown as Record<string, Record<string, unknown> | undefined>)[key];
  const fn = props?.[name];
  return typeof fn === "function" ? (fn as (event: unknown) => void) : undefined;
}

function fakeClick(target: EventTarget | null) {
  return {
    preventDefault() {},
    stopPropagation() {},
    target,
    currentTarget: target,
    type: "click",
    nativeEvent: { isTrusted: false },
  };
}

/** If a host script swallows click before React sees it, run the button's onClick from pointerup. */
export function installClickFallback() {
  let last = 0;
  const onPointerUp = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const raw = event.target;
    if (!(raw instanceof Element)) return;
    const button = raw.closest("button");
    if (!button || button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true") return;
    let seen = false;
    const mark = () => {
      seen = true;
    };
    button.addEventListener("click", mark, { capture: true, once: true });
    window.setTimeout(() => {
      button.removeEventListener("click", mark, true);
      if (seen) return;
      const now = Date.now();
      if (now - last < 280) return;
      last = now;
      const click = reactHandler(button, "onClick");
      if (click) {
        click(fakeClick(raw));
        return;
      }
      if (button instanceof HTMLButtonElement && button.type === "submit" && button.form) {
        const submit = reactHandler(button.form, "onSubmit");
        if (submit) {
          submit({
            preventDefault() {},
            stopPropagation() {},
            target: button.form,
            currentTarget: button.form,
          });
          return;
        }
        button.form.requestSubmit(button);
      }
    }, 120);
  };
  window.addEventListener("pointerup", onPointerUp, true);
  return () => window.removeEventListener("pointerup", onPointerUp, true);
}
