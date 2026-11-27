// @ts-check
/**
 * One place that decides HOW the site talks to Postgres (any provider: Neon,
 * a self-hosted VPS, Enzonic, …). Shared by `src/lib/db.ts`, better-auth
 * (`src/lib/auth/server.ts`), `src/lib/ai/memory-store.server.ts` and the deploy
 * migrator `scripts/migrate.mjs`.
 *
 * Environment (all optional; with none set the behaviour matches the old code,
 * except for the serverless-friendly pool limits below):
 *   PG_POOL_MAX               max connections per pool per instance (default 3, 1..50)
 *   PG_IDLE_TIMEOUT_MS        idle client lifetime (default 10000)
 *   PG_CONNECT_TIMEOUT_MS     connect timeout (default 10000)
 *   DATABASE_SSL_NO_VERIFY=1  encrypt, but do not verify the certificate
 *                             (self-signed server). Same as `?sslmode=no-verify`.
 *
 * node-postgres (pg-connection-string 2.x, see package-lock) treats
 * `sslmode=require` as full verification (it only logs a warning), so a
 * self-signed server needs `sslmode=no-verify`. A connection string overrides the
 * `ssl` option passed next to it, so the URL itself is rewritten when the flag
 * comes from the environment.
 */

/** @param {string | undefined} value @param {number} fallback @param {number} min @param {number} max */
function intEnv(value, fallback, min, max) {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** @param {string} url */
function queryOf(url) {
  const hash = url.indexOf("#");
  const clean = hash < 0 ? url : url.slice(0, hash);
  const at = clean.indexOf("?");
  return { base: at < 0 ? clean : clean.slice(0, at), params: new URLSearchParams(at < 0 ? "" : clean.slice(at + 1)) };
}

/**
 * True when the URL asks for `sslmode=no-verify` or the env flag is on.
 * @param {string} url
 * @param {Record<string, string | undefined>} [env]
 */
export function sslNoVerify(url, env = process.env) {
  const flag = String(env.DATABASE_SSL_NO_VERIFY ?? "").trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  return queryOf(url).params.get("sslmode") === "no-verify";
}

/**
 * Connection string with `sslmode=no-verify` forced (password and host are
 * left byte-for-byte as given). `uselibpqcompat` is dropped because it would
 * switch node-postgres back to certificate verification.
 * @param {string} url
 */
export function withNoVerify(url) {
  const { base, params } = queryOf(url);
  params.set("sslmode", "no-verify");
  params.delete("uselibpqcompat");
  return `${base}?${params.toString()}`;
}

/**
 * Options for `new pg.Pool(...)` / `new pg.Client(...)`.
 * @param {string} url
 * @param {{ max?: number, env?: Record<string, string | undefined> }} [opts]
 */
export function pgOptions(url, opts = {}) {
  const env = opts.env ?? process.env;
  const noVerify = sslNoVerify(url, env);
  /** @type {import("pg").PoolConfig} */
  const config = {
    connectionString: noVerify ? withNoVerify(url) : url,
    max: opts.max ?? intEnv(env.PG_POOL_MAX, 3, 1, 50),
    idleTimeoutMillis: intEnv(env.PG_IDLE_TIMEOUT_MS, 10_000, 1000, 600_000),
    connectionTimeoutMillis: intEnv(env.PG_CONNECT_TIMEOUT_MS, 10_000, 1000, 120_000),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  };
  if (noVerify) config.ssl = { rejectUnauthorized: false };
  return config;
}

/**
 * Keep an idle-client error (server restart, network drop, `idle_session_timeout`)
 * from becoming an uncaught 'error' event that kills the process.
 * @template {{ on(event: "error", fn: (err: Error) => void): unknown }} P
 * @param {P} pool
 * @param {string} [label]
 * @returns {P}
 */
export function guardPoolErrors(pool, label = "pg") {
  pool.on("error", (err) => {
    console.error(`[${label}] idle client error:`, err?.message || err);
  });
  return pool;
}
