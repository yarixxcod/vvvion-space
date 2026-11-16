import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

test("every catalog persona and gift SKU has distinct real raster art", () => {
  const personas = [
    ...readFileSync("src/lib/social/persona-data.ts", "utf8").matchAll(/id: "([a-z]+)"/g),
  ].map((m) => m[1]);
  const gifts = [
    ...new Set(
      readdirSync("migrations")
        .filter((f) => f.endsWith(".sql"))
        .flatMap((f) =>
          [...readFileSync(`migrations/${f}`, "utf8").matchAll(/'gift:([a-z]+)'/g)].map(
            (m) => m[1],
          ),
        ),
    ),
  ];
  assert.equal(personas.length, 19);
  assert.equal(gifts.length, 26);
  const hashes = new Set();
  for (const [kind, ids] of [
    ["personas", personas],
    ["gifts", gifts],
  ]) {
    for (const id of ids) {
      const bytes = readFileSync(`public/${kind}/${id}-v2.webp`);
      assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
      assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
      assert.ok(bytes.length > 20000, `${kind}/${id} should be a detailed illustration`);
      const hash = createHash("sha256").update(bytes).digest("hex");
      assert.ok(!hashes.has(hash), `${id} must not reuse another illustration`);
      hashes.add(hash);
    }
  }
  assert.equal(hashes.size, 45);
});
