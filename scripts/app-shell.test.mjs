import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/app-bridge.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function("require", "exports", js)((id) => {
  if (id === "@/lib/auth/client") return { getBearerToken: () => "" };
  if (id === "@/lib/social/push-policy") return { publicNotifyIcon: () => undefined };
  throw new Error(id);
}, exports);

test("app shell wrappers do nothing without the native bridge", () => {
  assert.equal(exports.appOpenSettings(), false);
  assert.equal(exports.appCheckUpdates(), false);
  assert.equal(exports.appWidgetSessionChanged(), false);
  assert.equal(exports.appRestoreQueue(), false);
  assert.equal(exports.appSavedQueue(), null);
  assert.equal(exports.appDiagnostics(), null);
});
