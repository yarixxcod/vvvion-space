import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { guardPoolErrors, pgOptions, sslNoVerify, withNoVerify } from "./pg-config.mjs";

const require = createRequire(import.meta.url);
const { parse } = require("pg-connection-string");
const URL_PASS = "postgresql://vvvion:p%40ss:w%2Frd@62.0.0.1:5432/vvvion";

test("sslmode=no-verify in the URL disables certificate verification", () => {
  const url = `${URL_PASS}?sslmode=no-verify`;
  assert.equal(sslNoVerify(url, {}), true);
  const cfg = pgOptions(url, { env: {} });
  assert.equal(cfg.ssl?.rejectUnauthorized, false);
  assert.equal(parse(cfg.connectionString).ssl.rejectUnauthorized, false);
});

test("DATABASE_SSL_NO_VERIFY overrides sslmode=require and keeps the password intact", () => {
  const url = `${URL_PASS}?sslmode=require&channel_binding=require`;
  assert.equal(sslNoVerify(url, {}), false);
  const cfg = pgOptions(url, { env: { DATABASE_SSL_NO_VERIFY: "1" } });
  const parsed = parse(cfg.connectionString);
  assert.equal(parsed.ssl.rejectUnauthorized, false);
  assert.equal(parsed.password, "p@ss:w/rd");
  assert.equal(parsed.host, "62.0.0.1");
  assert.equal(parsed.database, "vvvion");
  assert.match(cfg.connectionString, /channel_binding=require/);
});

test("uselibpqcompat cannot bring verification back", () => {
  const out = withNoVerify(`${URL_PASS}?sslmode=require&uselibpqcompat=true`);
  assert.equal(parse(out).ssl.rejectUnauthorized, false);
  assert.doesNotMatch(out, /uselibpqcompat/);
});

test("a normal Neon-style URL is passed through untouched", () => {
  const url = "postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/db?sslmode=require";
  const cfg = pgOptions(url, { env: {} });
  assert.equal(cfg.connectionString, url);
  assert.equal(cfg.ssl, undefined);
});

test("pool limits come from env with safe defaults and clamps", () => {
  const url = `${URL_PASS}?sslmode=no-verify`;
  const d = pgOptions(url, { env: {} });
  assert.deepEqual([d.max, d.idleTimeoutMillis, d.connectionTimeoutMillis, d.keepAlive], [3, 10000, 10000, true]);
  assert.equal(pgOptions(url, { env: { PG_POOL_MAX: "7" } }).max, 7);
  assert.equal(pgOptions(url, { env: { PG_POOL_MAX: "0" } }).max, 1);
  assert.equal(pgOptions(url, { env: { PG_POOL_MAX: "999" } }).max, 50);
  assert.equal(pgOptions(url, { env: { PG_POOL_MAX: "abc" } }).max, 3);
  assert.equal(pgOptions(url, { env: { PG_POOL_MAX: "9" }, max: 1 }).max, 1);
});

test("guardPoolErrors swallows idle client errors", () => {
  const handlers = [];
  const pool = { on: (_e, fn) => handlers.push(fn) };
  guardPoolErrors(pool, "t");
  const log = console.error;
  console.error = () => {};
  try {
    assert.doesNotThrow(() => handlers[0](new Error("boom")));
  } finally {
    console.error = log;
  }
});
