import test from "node:test";
import assert from "node:assert/strict";
import { pastedFiles } from "./clipboard-images.ts";
const transfer = (files: File[], items: unknown[] = []) =>
  ({ files, items }) as unknown as Pick<DataTransfer, "files" | "items">;
test("screenshots exposed through items only are attached and named", () => {
  const file = new File(["png"], "image", { type: "image/png" });
  const next = pastedFiles(transfer([], [{ kind: "file", getAsFile: () => file }]));
  assert.equal(next.length, 1);
  assert.match(next[0].name, /\.png$/);
  assert.equal(next[0].type, "image/png");
});
test("one bitmap present in files and items is not attached twice", () => {
  const file = new File(["png"], "shot.png", { type: "image/png" });
  assert.equal(pastedFiles(transfer([file], [{ kind: "file", getAsFile: () => file }])).length, 1);
});
test("text and HTML clipboard items are not treated as downloads", () => {
  assert.deepEqual(
    pastedFiles(transfer([], [{ kind: "string", type: "text/html", getAsFile: () => null }])),
    [],
  );
});
