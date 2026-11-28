import assert from "node:assert/strict";
import { test } from "node:test";
import { markdownPlainText as plain } from "./plain-text.ts";
test("copy prose without Markdown while preserving code literally", () => {
  assert.equal(
    plain("# Heading\n\n**Bold** and _em_\n\n```plain\n  **literal**\n# literal\n```"),
    "Heading\n\nBold and em\n\n  **literal**\n# literal",
  );
  assert.equal(plain("```txt\n  spaces  \n```"), "  spaces  ");
  assert.equal(plain("Inline `**literal**`"), "Inline **literal**");
});
test("copy lists, references, table and safe links readably", () => {
  assert.equal(plain("3. third\n4. fourth\n\n- one\n- two"), "3. third\n4. fourth\n\n- one\n- two");
  assert.equal(
    plain("[Site](https://example.com) and [ref][x]\n\n[x]: https://example.org"),
    "Site (https://example.com/) and ref (https://example.org/)",
  );
  assert.equal(plain("| A | B |\n| --- | --- |\n| 1 | 2 |"), "A\tB\n1\t2");
  assert.equal(plain("[bad](javascript:alert%281%29)"), "bad");
});
