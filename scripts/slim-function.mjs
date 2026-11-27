/**
 * Build-time switches that keep the stored Vercel deployment small.
 * Every stored deployment counts against the team's Deployment / Functions
 * Storage, so dead weight is multiplied by the number of deployments kept.
 */

/** Production runs on Neon: the embedded PGlite (~17 MB of wasm/data) is never loaded. */
export function slimPglite(env) {
  return env.VERCEL_ENV === "production" && Boolean(env.DATABASE_URL && env.DATABASE_URL.trim());
}

/**
 * Leave the 41 MB yt-dlp binary out of the function; ytdlp.server.ts downloads the
 * pinned, SHA-256-verified release into /tmp on first use.
 *   VVVION_SLIM_YTDLP=1      force on (e.g. in Production once tried on a preview)
 *   VVVION_BUNDLE_YTDLP=1    force the old behaviour (bundle the binary)
 * Default: on for Vercel Preview builds, off for Production builds and local builds.
 */
export function slimYtdlp(env) {
  if (env.VVVION_BUNDLE_YTDLP === "1") return false;
  if (env.VVVION_SLIM_YTDLP === "1") return true;
  return env.VERCEL_ENV === "preview";
}
