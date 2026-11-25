import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";
const exports = {};
new Function(
  "exports",
  ts.transpileModule(readFileSync("src/lib/image-download.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
)(exports);
test("image filenames preserve a meaningful name with the actual MIME extension", () => {
  assert.equal(exports.imageDownloadName("Фото.png", "image/jpeg"), "Фото.jpg");
  assert.equal(exports.imageDownloadName("../evil:name", "image/webp"), ".._evil_name.webp");
  assert.equal(exports.imageDownloadName("", "image/png"), "vvvion-image.png");
  assert.throws(() => exports.imageDownloadName("picture", "text/html"), /вместо изображения/);
});
test("original bytes and MIME are saved, while errors and HTML are not downloads", async (t) => {
  const prior = globalThis.fetch;
  t.after(() => (globalThis.fetch = prior));
  globalThis.fetch = async () =>
    new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
  const file = await exports.fetchImageFile("blob:test", "Photo", new AbortController().signal);
  assert.equal(file.name, "Photo.png");
  assert.equal(file.type, "image/png");
  assert.equal(file.size, 3);
  globalThis.fetch = async () =>
    new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } });
  await assert.rejects(
    exports.fetchImageFile("/private", "Photo", new AbortController().signal),
    /вместо изображения/,
  );
  globalThis.fetch = async () => new Response("", { status: 403 });
  await assert.rejects(
    exports.fetchImageFile("/private", "Photo", new AbortController().signal),
    /оригинал/,
  );
});
test("a cancelled image preparation never returns a partial file", async (t) => {
  const prior = globalThis.fetch;
  t.after(() => (globalThis.fetch = prior));
  const ctrl = new AbortController();
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array([1]));
          ctrl.abort();
          c.close();
        },
      }),
      { headers: { "content-type": "image/png" } },
    );
  await assert.rejects(exports.fetchImageFile("blob:test", "Photo", ctrl.signal));
});
