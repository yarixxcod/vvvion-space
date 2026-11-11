import { useEffect, useRef, useState } from "react";
import type { AltchaWidgetElement } from "altcha";
import "altcha/altcha.css";
import { useLang } from "@/lib/lang";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "altcha-widget": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export function HumanCheck({ resetKey = 0, onPayload }: { resetKey?: number; onPayload: (payload: string) => void }) {
  const lang = useLang();
  const ref = useRef<AltchaWidgetElement | null>(null);
  const onPayloadRef = useRef(onPayload);
  const [insecure, setInsecure] = useState(false);
  onPayloadRef.current = onPayload;

  useEffect(() => {
    if (!window.isSecureContext) {
      setInsecure(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    let live = true;
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<{ state?: string; payload?: string | null }>).detail;
      if (detail?.state === "verified" && detail.payload) onPayloadRef.current(detail.payload);
      else if (detail?.state === "error" || detail?.state === "expired" || detail?.state === "unverified") onPayloadRef.current("");
    };
    el.addEventListener("statechange", onState);
    void (async () => {
      await import("altcha");
      if (lang === "en") await import("altcha/i18n/en");
      else if (lang === "kk") await import("altcha/i18n/kk");
      else await import("altcha/i18n/ru");
      if (!live) return;
      const code = lang === "en" ? "en" : lang === "kk" ? "kk" : "ru";
      await el.configure({
        challenge: "/api/captcha",
        hideFooter: true,
        hideLogo: true,
        language: code,
        name: "proof",
      });
    })();
    return () => {
      live = false;
      el.removeEventListener("statechange", onState);
    };
  }, [lang, resetKey]);

  if (insecure) {
    return <p className="text-xs text-faint">Подтверждение открывается только по защищённому адресу сайта.</p>;
  }

  return (
    <div className="human-check">
      <altcha-widget key={resetKey} ref={ref} />
    </div>
  );
}
