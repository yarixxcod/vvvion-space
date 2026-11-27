/** Pre-sized copies next to each `*-v2.webp` (see public/personas, public/gifts): 96, 144 and 384 px wide. */
export const ART_WIDTHS = [96, 144, 384] as const;

/** srcSet for a `/personas/<id>-v2.webp` or `/gifts/<id>-v2.webp` URL; empty for anything else. */
export function artSrcSet(src: string, fullWidth = 768) {
  if (!/^\/(personas|gifts)\/[a-z0-9-]+-v2\.webp$/.test(src)) return undefined;
  const base = src.slice(0, -".webp".length);
  return [...ART_WIDTHS.map((w) => `${base}-${w}.webp ${w}w`), `${src} ${fullWidth}w`].join(", ");
}
