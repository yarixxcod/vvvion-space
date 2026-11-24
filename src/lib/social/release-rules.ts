export const RELEASE_CHUNK = 512 * 1024;
export const ANDROID_MAX = 80 * 1024 * 1024;
export const WINDOWS_MIN = 1024 * 1024;
export const WINDOWS_MAX = 150 * 1024 * 1024;

const SEMVER = /^\d+\.\d+\.\d+$/;

export function semverOk(value: string): boolean {
  return SEMVER.test(value);
}

export function compareSemver(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function semverNewer(next: string, current: string): boolean {
  return semverOk(next) && (!current || (semverOk(current) && compareSemver(next, current) > 0));
}

export function exeName(version: string): string {
  return `vvvion-space-desktop-${version}-x64-setup.exe`;
}

export function chunkCount(size: number): number {
  if (size < 1) return 0;
  return Math.ceil(size / RELEASE_CHUNK);
}

export function chunkSpan(size: number, index: number): { start: number; bytes: number } {
  const start = index * RELEASE_CHUNK;
  return { start, bytes: Math.max(0, Math.min(RELEASE_CHUNK, size - start)) };
}

/** Accept a Tauri `.sig`: base64 whose decoded text starts with `untrusted comment:`. */
export function cleanSignature(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 4096) return null;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(text)) return null;
  const compact = text.replace(/\s/g, "");
  if (compact.length < 8 || compact.length % 4 === 1) return null;
  const decoded = Buffer.from(compact, "base64").toString("utf8");
  if (!decoded.startsWith("untrusted comment:")) return null;
  return text;
}

export type UpdatePath = { target: string; arch: string; version: string } | null;

export function parseUpdatePath(pathname: string): UpdatePath {
  const match = /^\/api\/app\/desktop\/update\/([^/]+)\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  return { target: decodeURIComponent(match[1] || ""), arch: decodeURIComponent(match[2] || ""), version: decodeURIComponent(match[3] || "") };
}

export function updateWanted(path: UpdatePath): boolean {
  return Boolean(path && path.target === "windows" && path.arch === "x86_64" && semverOk(path.version));
}

export function updaterBody(input: { version: string; notes: string; publishedAt: string; url: string; signature: string }) {
  const published = new Date(input.publishedAt);
  const pub = Number.isNaN(published.getTime()) ? new Date().toISOString() : published.toISOString();
  return {
    version: input.version,
    notes: input.notes,
    pub_date: pub.replace(/\.\d{3}Z$/, "Z"),
    url: input.url,
    signature: input.signature.trim(),
  };
}

/** Public Android manifest. Field names and order are part of the app contract. */
export function versionDocument(origin: string, view: { versionCode: number; versionName: string; fileName: string; changelog: string; force: boolean }) {
  return {
    versionCode: view.versionCode,
    versionName: view.versionName,
    apkUrl: `${origin}/app/${view.fileName}`,
    changelog: view.changelog,
    force: view.force,
  };
}
