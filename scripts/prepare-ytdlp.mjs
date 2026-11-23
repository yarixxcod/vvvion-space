import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, chmod, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// Official immutable Linux release; verify bytes before packaging/executing.
const version = "2026.10.26";
const digest = "767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795";
const destination = resolve(".bin/yt-dlp");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (process.platform !== "linux" || process.arch !== "x64") {
  if (process.env.VERCEL) throw new Error("yt-dlp packaging requires Linux x64");
  console.log("yt-dlp: native local binary may be supplied with YTDLP_BIN");
} else {
  const cached = await readFile(destination).catch(() => null);
  if (!cached || sha(cached) !== digest) {
    const urls = [
      ...(process.env.YTDLP_MIRROR_URLS || "").split(",").map((item) => item.trim()).filter(Boolean),
      `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/yt-dlp_linux`,
    ];
    let bytes = null;
    let last = "yt-dlp download failed";
    for (const url of urls) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next = Buffer.from(await response.arrayBuffer());
        if (sha(next) !== digest) throw new Error("yt-dlp checksum mismatch");
        bytes = next;
        break;
      } catch (error) {
        last = error instanceof Error ? error.message : last;
      }
    }
    if (!bytes) throw new Error(last);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(`${destination}.part`, bytes);
    await rename(`${destination}.part`, destination);
  }
  await chmod(destination, 0o755);
  console.log(`yt-dlp ${version}: verified and ready to package`);
}
