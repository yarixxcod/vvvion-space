import { useEffect, useRef, useState } from "react";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { officeKind, readOffice, type OfficeView } from "@/lib/files/office-preview";

const MAX = 30 * 1024 * 1024;

type View =
  | { type: "pdf"; url: string }
  | { type: "office"; office: OfficeView }
  | { type: "empty" };

export function DocPreview({
  name,
  src,
  headers,
  className = "",
}: {
  name: string;
  src: string;
  headers?: HeadersInit;
  className?: string;
}) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const headerRef = useRef(headers);
  headerRef.current = headers;

  useEffect(() => {
    let dead = false;
    let url = "";
    const ctrl = new AbortController();
    setView(null);
    setError("");
    void (async () => {
      const res = await fetch(src, { credentials: "same-origin", headers: headerRef.current, signal: ctrl.signal });
      if (!res.ok) throw new Error("Файл не открылся");
      const announced = Number(res.headers.get("content-length") || 0);
      if (announced > MAX) throw new Error("Слишком большой для превью. Его можно скачать.");
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (dead) return;
      if (bytes.length > MAX) throw new Error("Слишком большой для превью. Его можно скачать.");
      const pdf = officeKind(name) === "pdf" || (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
      if (pdf) {
        const copy = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(copy).set(bytes);
        url = URL.createObjectURL(new Blob([copy], { type: "application/pdf" }));
        setView({ type: "pdf", url });
        return;
      }
      const office = readOffice(name, bytes);
      setView(office ? { type: "office", office } : { type: "empty" });
    })().catch((err: unknown) => {
      if (!dead && !(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "Файл не открылся");
      }
    });
    return () => {
      dead = true;
      ctrl.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [name, src]);

  if (error) return <p className="px-4 text-center text-sm">{error}</p>;
  if (!view) return <PageLoader compact />;
  if (view.type === "pdf") {
    return <iframe title={name} src={view.url} className={`h-full min-h-[70dvh] w-full rounded-2xl bg-white ${className}`} />;
  }
  if (view.type === "empty") {
    return <p className="px-6 text-center text-sm">Превью для этого файла нет. Его можно скачать.</p>;
  }
  if (view.office.kind === "table") {
    return (
      <div className={`max-h-full w-full overflow-auto rounded-2xl bg-elev p-3 ${className}`}>
        <table className="w-full border-collapse text-left text-xs">
          <tbody>
            {view.office.rows.map((row, index) => (
              <tr key={index} className="border-b border-line">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-2 py-1 align-top whitespace-pre-wrap">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return <pre className={`max-h-full w-full overflow-auto rounded-2xl bg-elev p-4 text-left text-sm whitespace-pre-wrap ${className}`}>{view.office.text}</pre>;
}
