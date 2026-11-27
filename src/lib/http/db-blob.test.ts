import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { OPEN_RANGE_CAP, base64Window, decodedSize, readStoredBytes, storedBytesResponse } from "./db-blob.ts";

const sizes = [0, 1, 2, 3, 4, 5, 6, 7, 100, 1000];

test("decodedSize matches Buffer for every padding case", () => {
  for (const n of sizes) {
    const b64 = Buffer.alloc(n, 7).toString("base64");
    assert.equal(decodedSize(b64.length, b64.slice(-2)), n);
  }
  assert.equal(decodedSize(5, "ab"), null);
  assert.equal(decodedSize("8", "AA"), 6);
});

test("base64Window covers exactly the requested bytes", () => {
  const bytes = Buffer.from(Array.from({ length: 50 }, (_, i) => i * 5));
  const b64 = bytes.toString("base64");
  for (let start = 0; start < 50; start += 1) {
    for (const end of [start, Math.min(49, start + 1), Math.min(49, start + 7), 49]) {
      const win = base64Window(start, end);
      const part = Buffer.from(b64.slice(win.from, win.from + win.length), "base64").subarray(win.skip, win.skip + end - start + 1);
      assert.deepEqual([...part], [...bytes.subarray(start, end + 1)], `${start}-${end}`);
    }
  }
});

async function fixture(size: number) {
  const db = new PGlite();
  await db.exec("create table post_files (id text primary key, data text not null)");
  await db.exec("create table room_files (id text primary key, data text not null)");
  await db.exec("create table disk_files (id text primary key, data text not null)");
  const bytes = Buffer.from(Array.from({ length: size }, (_, i) => (i * 31 + 7) & 255));
  await db.query("insert into post_files values ('f', $1)", [bytes.toString("base64")]);
  const sql = Object.assign(
    ((strings: TemplateStringsArray, ...values: unknown[]) => {
      let text = strings[0] ?? "";
      values.forEach((_, i) => (text += `$${i + 1}${strings[i + 1]}`));
      return db.query(text, values).then((r) => r.rows);
    }) as never,
    { query: (text: string, params: unknown[] = []) => db.query(text, params).then((r) => r.rows) },
  ) as import("@/lib/db").Sql;
  const meta = (await db.query<{ chars: number; tail: string }>("select length(data) as chars, right(data, 2) as tail from post_files where id = 'f'")).rows[0]!;
  return { sql, bytes, meta, db };
}

test("readStoredBytes returns the same bytes as slicing the whole file", async () => {
  const { sql, bytes, db } = await fixture(1003);
  for (const [a, b] of [[0, 0], [0, 1002], [1, 2], [2, 3], [3, 3], [500, 900], [1001, 1002]] as const) {
    const got = await readStoredBytes(sql, "post_files", "f", a, b);
    assert.deepEqual([...(got ?? [])], [...bytes.subarray(a, b + 1)], `${a}-${b}`);
  }
  assert.equal(await readStoredBytes(sql, "post_files", "missing", 0, 1), null);
  await assert.rejects(() => readStoredBytes(sql, "user; drop" as never, "f", 0, 1));
  await db.close();
});

test("storedBytesResponse answers 200 / 206 / 416 / HEAD like bytesResponse", async () => {
  const { sql, bytes, meta, db } = await fixture(1003);
  const call = (headers: Record<string, string>, method = "GET", media = false) =>
    storedBytesResponse({
      request: new Request("https://x.test/f", { method, headers }),
      headers: new Headers({ "content-type": "application/octet-stream" }),
      sql,
      table: "post_files",
      id: "f",
      chars: meta.chars,
      tail: meta.tail,
      media,
    });
  const full = await call({});
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-length"), "1003");
  assert.deepEqual([...Buffer.from(await full.arrayBuffer())], [...bytes]);

  const part = await call({ range: "bytes=10-19" });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), "bytes 10-19/1003");
  assert.deepEqual([...Buffer.from(await part.arrayBuffer())], [...bytes.subarray(10, 20)]);

  const tail = await call({ range: "bytes=-5" });
  assert.deepEqual([...Buffer.from(await tail.arrayBuffer())], [...bytes.subarray(998)]);

  const bad = await call({ range: "bytes=5000-" });
  assert.equal(bad.status, 416);
  assert.equal(bad.headers.get("content-range"), "bytes */1003");

  const head = await call({}, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "1003");
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  await db.close();
});

test("open-ended ranges on media are capped, explicit ones are not", async () => {
  const size = OPEN_RANGE_CAP + 5000;
  const { sql, meta, db } = await fixture(size);
  const ask = (range: string, media: boolean) =>
    storedBytesResponse({
      request: new Request("https://x.test/f", { headers: { range } }),
      headers: new Headers(),
      sql,
      table: "post_files",
      id: "f",
      chars: meta.chars,
      tail: meta.tail,
      media,
    });
  const open = await ask("bytes=0-", true);
  assert.equal(open.status, 206);
  assert.equal(open.headers.get("content-range"), `bytes 0-${OPEN_RANGE_CAP - 1}/${size}`);
  assert.equal((await open.arrayBuffer()).byteLength, OPEN_RANGE_CAP);
  const image = await ask("bytes=0-", false);
  assert.equal(image.headers.get("content-range"), `bytes 0-${size - 1}/${size}`);
  await image.arrayBuffer();
  const explicit = await ask(`bytes=0-${size - 1}`, true);
  assert.equal(explicit.headers.get("content-range"), `bytes 0-${size - 1}/${size}`);
  await explicit.arrayBuffer();
  await db.close();
});
