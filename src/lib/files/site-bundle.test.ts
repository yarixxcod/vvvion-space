import test from "node:test";
import assert from "node:assert/strict";
import { sitePath, siteMime, rewriteSiteImports } from "./site-bundle.ts";
import { documentKind, isSiteAsset } from "./document-kind.ts";
test("site paths resolve relative to HTML or module, including a root path", () => {
  assert.equal(sitePath("../styles/main.css", "pages/about.html"), "styles/main.css");
  assert.equal(sitePath("./helper.js", "scripts/app.js"), "scripts/helper.js");
  assert.equal(sitePath("/main.js?version=2#x", "pages/about.html"), "main.js");
});
test("external URLs, encoded traversal and executable schemes never become local files", () => {
  for (const value of [
    "https://other.test/app.js",
    "//other.test/a",
    "javascript:alert(1)",
    "/%2e%2e%2fsecret",
  ])
    assert.equal(sitePath(value), null);
});
test("asset MIME comes from extension when generated files have a generic storage MIME", () => {
  assert.equal(siteMime("assets/icon.svg", "text/plain"), "image/svg+xml");
  assert.equal(siteMime("font.woff2", "application/octet-stream"), "font/woff2");
  assert.equal(siteMime("data.json", "text/plain"), "application/json");
});
test("document and static preview formats are explicit", () => {
  for (const name of ["note.md", "index.html", "app.js", "styles.css", "data.csv"])
    assert.equal(documentKind(name), "text");
  assert.equal(documentKind("report.docx"), "docx");
  assert.equal(documentKind("binary.exe"), null);
  assert.equal(isSiteAsset("video.mp4"), false);
});

test("module imports support multiline, side effects, dynamic imports and re-exports", () => {
  const source =
    "import './setup.js'\nimport {\n label\n} from './helper.js';\nexport * from './helper.js';\nconst value=import('./helper.js');";
  const rewritten = rewriteSiteImports(
    source,
    "scripts/app.js",
    new Set(["scripts/setup.js", "scripts/helper.js"]),
  );
  assert.match(rewritten, /import '@vvvion\/scripts\/setup.js'/);
  assert.match(rewritten, /from '@vvvion\/scripts\/helper.js'/);
  assert.match(rewritten, /import\('@vvvion\/scripts\/helper.js'\)/);
});
