import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { ART_WIDTHS, artSrcSet } from "./art-srcset.ts";

test("srcSet lists the small copies and the original", () => {
  assert.equal(
    artSrcSet("/personas/chef-v2.webp"),
    "/personas/chef-v2-96.webp 96w, /personas/chef-v2-144.webp 144w, /personas/chef-v2-384.webp 384w, /personas/chef-v2.webp 768w",
  );
  assert.equal(artSrcSet("/personas/chef.svg"), undefined);
  assert.equal(artSrcSet("https://example.com/x-v2.webp"), undefined);
});

test("every catalog image has its small copies on disk", () => {
  for (const kind of ["personas", "gifts"]) {
    const dir = new URL(`../../public/${kind}/`, import.meta.url);
    const originals = readdirSync(dir).filter((name) => /^[a-z0-9-]+-v2\.webp$/.test(name));
    assert.ok(originals.length > 0, kind);
    for (const name of originals) {
      for (const w of ART_WIDTHS) {
        const copy = name.replace(/\.webp$/, `-${w}.webp`);
        assert.ok(existsSync(new URL(copy, dir)), `${kind}/${copy}`);
      }
    }
  }
});

test("fonts are self-hosted and every @font-face file exists", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const root = readFileSync(new URL("../routes/__root.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(css + root, /fonts\.(googleapis|gstatic)\.com/);
  const files = [...(css + root).matchAll(/\/fonts\/([a-z0-9.-]+\.woff2)/g)].map((m) => m[1]);
  assert.ok(files.length >= 12);
  for (const name of files) assert.ok(existsSync(new URL(`../../public/fonts/${name}`, import.meta.url)), name);
});
