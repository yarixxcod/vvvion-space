import assert from "node:assert/strict";
import test from "node:test";
import { slimPglite, slimYtdlp } from "./slim-function.mjs";

test("PGlite is only dropped from Production builds that have a database", () => {
  assert.equal(slimPglite({ VERCEL_ENV: "production", DATABASE_URL: "postgres://x" }), true);
  assert.equal(slimPglite({ VERCEL_ENV: "production", DATABASE_URL: "  " }), false);
  assert.equal(slimPglite({ VERCEL_ENV: "production" }), false);
  assert.equal(slimPglite({ VERCEL_ENV: "preview", DATABASE_URL: "postgres://x" }), false);
  assert.equal(slimPglite({ DATABASE_URL: "postgres://x" }), false);
});

test("yt-dlp: bundled in Production and locally, left out of Previews, overridable", () => {
  assert.equal(slimYtdlp({}), false);
  assert.equal(slimYtdlp({ VERCEL_ENV: "production" }), false);
  assert.equal(slimYtdlp({ VERCEL_ENV: "preview" }), true);
  assert.equal(slimYtdlp({ VERCEL_ENV: "preview", VVVION_BUNDLE_YTDLP: "1" }), false);
  assert.equal(slimYtdlp({ VERCEL_ENV: "production", VVVION_SLIM_YTDLP: "1" }), true);
  assert.equal(slimYtdlp({ VVVION_SLIM_YTDLP: "1", VVVION_BUNDLE_YTDLP: "1" }), false);
});
