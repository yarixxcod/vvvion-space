import assert from "node:assert/strict";
import test from "node:test";
import { safeAppPath } from "./safe-path.ts";

test("login redirect stays inside the app", () => {
  assert.equal(safeAppPath("/c/play"), "/c/play");
  assert.equal(safeAppPath("/?place=disk"), "/?place=disk");
  assert.equal(safeAppPath("https://evil.com"), "/");
  assert.equal(safeAppPath("//evil.com"), "/");
  assert.equal(safeAppPath("/\\evil.com"), "/");
  assert.equal(safeAppPath("/%2f%2fevil.com"), "/");
  assert.equal(safeAppPath("/login"), "/");
  assert.equal(safeAppPath("/login?redirect=/c/play"), "/");
  assert.equal(safeAppPath(""), "/");
  assert.equal(safeAppPath(undefined), "/");
});
