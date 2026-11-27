import { useState } from "react";
import { ImageOff } from "lucide-react";
import { artSrcSet } from "@/lib/art-srcset";

export function giftRarity(price: number) {
  if (price >= 5000) return { tier: "legendary", label: "Легендарный" };
  if (price >= 1000) return { tier: "epic", label: "Эпический" };
  if (price >= 200) return { tier: "rare", label: "Редкий" };
  return { tier: "classic", label: "Классика" };
}

/** Versioned URLs avoid stale SVGs in WebView and service-worker caches. */
export function CatalogArt({
  kind,
  id,
  alt = "",
  className = "",
  sizes = "(min-width: 768px) 240px, 45vw",
  priority = false,
}: {
  kind: "gifts" | "personas";
  id: string;
  alt?: string;
  className?: string;
  /** CSS width the image is shown at, e.g. "40px"; picks the right file from srcSet. */
  sizes?: string;
  /** Above-the-fold image: load eagerly with high priority. */
  priority?: boolean;
}) {
  const src = /^[a-z0-9-]+$/.test(id) ? `/${kind}/${id}-v2.webp` : "";
  const [failed, setFailed] = useState("");
  return (
    <span data-art-kind={kind}
      className={`catalog-art relative block shrink-0 overflow-hidden bg-subtle ${className}`}>
      {src && failed !== src ? (
        <img
          src={src}
          srcSet={artSrcSet(src)}
          sizes={sizes}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
          width={768}
          height={768}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.035] motion-reduce:transform-none"
          onError={() => setFailed(src)}
        />
      ) : (
        <span
          role="img"
          aria-label={alt || "Изображение недоступно"}
          className="absolute inset-0 grid place-items-center text-muted"
        >
          <ImageOff className="size-7" />
        </span>
      )}
    </span>
  );
}
