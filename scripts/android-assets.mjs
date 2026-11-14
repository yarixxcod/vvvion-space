import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

// Build from this checkout, never fetch an unrelated production deployment.
const source = resolve(".vercel/output/static");
const destination = resolve("android/app/src/main/assets/www");
await readdir(source); // Fail before removing previous resources if web build is missing.
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
const entries = [];
async function copy(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) { await copy(path); continue; }
    // Never bundle server output, HTML, source maps or credentials.
    if (!/\.(?:js|mjs|css|woff2?|ttf|otf|svg|png|jpe?g|webp|avif|gif|ico)$/i.test(item.name)) continue;
    const name = relative(source, path).split("\\").join("/");
    await mkdir(join(destination, name, ".."), { recursive: true });
    await cp(path, join(destination, name));
    entries.push(`https://vvvion.space/${name}\twww/${name}`);
  }
}
await copy(source);
if (!entries.length) throw new Error("Web build did not contain static assets");
await writeFile("android/app/src/main/assets/index.txt", entries.sort().join("\n") + "\n");
console.log(`Packaged ${entries.length} web resources from this checkout`);
