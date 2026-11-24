import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "@/lib/db";
import {
  desktopBegin,
  desktopBytes,
  desktopChunk,
  desktopDrop,
  desktopFinish,
  desktopLatest,
  desktopUpdate,
} from "@/lib/social/desktop-release.server";
import { memoryReleaseStore, streamObject, streamStoredApk } from "@/lib/social/release-blob.server";
import { cleanSignature, compareSemver, exeName, parseUpdatePath, semverNewer, semverOk, updateWanted, updaterBody, versionDocument } from "@/lib/social/release-rules";

const slots = readFileSync(new URL("../../../migrations/0039_app_release_slots.sql", import.meta.url), "utf8");
const desktop = readFileSync(new URL("../../../migrations/0061_desktop_release.sql", import.meta.url), "utf8");
const SIG = Buffer.from("untrusted comment: signature from tauri secret key\nRWTTEST\n").toString("base64");

function toSql(pg: PGlite): Sql {
  const run = async <T>(text: string, params: unknown[]) => (await pg.query<T>(text, params)).rows;
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0] || "";
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  sql.query = <T>(text: string, params: unknown[] = []) => run<T>(text, params);
  return sql;
}

async function db() {
  const pg = new PGlite();
  await pg.exec(slots);
  await pg.exec(desktop);
  return { sql: toSql(pg), close: () => pg.close() };
}

function ask(path: string) {
  return new Request(`https://vvvion.space${path}`);
}

function installer(mark = 0x11) {
  const file = Buffer.alloc(1024 * 1024, mark);
  file[0] = 0x4d;
  file[1] = 0x5a;
  return file;
}

async function publish(sql: Sql, store: ReturnType<typeof memoryReleaseStore>, version: string, file: Buffer, notes = "• Что нового") {
  const began = await desktopBegin(sql, store, { version, changelog: notes, signature: SIG, size: file.byteLength });
  assert.equal(began.status, 200);
  const chunk = 512 * 1024;
  for (let offset = 0, index = 0; offset < file.byteLength; offset += chunk, index += 1) {
    const slice = file.subarray(offset, offset + chunk);
    const sent = await desktopChunk(sql, store, { index, data: Buffer.from(slice).toString("base64") });
    assert.equal(sent.status, 200, await sent.clone().text());
  }
  const done = await desktopFinish(sql, store);
  assert.equal(done.status, 200, await done.clone().text());
}

test("semver, path and signature rules", () => {
  assert.equal(compareSemver("0.10.0", "0.9.0"), 1);
  assert.equal(compareSemver("0.9.0", "0.10.0"), -1);
  assert.equal(compareSemver("1.2.3", "1.2.3"), 0);
  assert.equal(semverNewer("0.2.0", "0.2.0"), false);
  assert.equal(semverNewer("0.2.0", "0.1.0"), true);
  assert.equal(semverNewer("0.2.0", ""), true);
  assert.equal(semverOk("0.2.0"), true);
  assert.equal(semverOk("abc"), false);
  assert.equal(semverOk("1.2"), false);
  assert.deepEqual(parseUpdatePath("/api/app/desktop/update/windows/x86_64/0.1.0"), { target: "windows", arch: "x86_64", version: "0.1.0" });
  assert.equal(parseUpdatePath("/app/version.json"), null);
  assert.equal(updateWanted({ target: "linux", arch: "x86_64", version: "0.1.0" }), false);
  assert.equal(updateWanted({ target: "windows", arch: "aarch64", version: "0.1.0" }), false);
  assert.equal(updateWanted({ target: "windows", arch: "x86_64", version: "abc" }), false);
  assert.equal(updateWanted({ target: "windows", arch: "x86_64", version: "0.1.0" }), true);
  assert.equal(exeName("0.2.0"), "vvvion-space-desktop-0.2.0-x64-setup.exe");
  assert.equal(cleanSignature(SIG), SIG);
  assert.equal(cleanSignature(`  ${SIG}\n`), SIG);
  assert.equal(cleanSignature("untrusted comment: raw"), null);
  assert.equal(cleanSignature("hello"), null);
  assert.equal(cleanSignature(""), null);
  const body = updaterBody({ version: "0.2.0", notes: "• notes", publishedAt: "2026-11-24T07:30:00.000Z", url: "https://vvvion.space/app/desktop/a.exe", signature: SIG });
  assert.equal(body.pub_date, "2026-11-24T07:30:00Z");
  assert.deepEqual(Object.keys(body), ["version", "notes", "pub_date", "url", "signature"]);
});

test("version.json keeps the android field set", () => {
  const doc = versionDocument("https://vvvion.space", {
    versionCode: 6,
    versionName: "2.4.0",
    fileName: "vvvion-space-2.4.0.apk",
    changelog: "hi",
    force: false,
  });
  assert.deepEqual(doc, {
    versionCode: 6,
    versionName: "2.4.0",
    apkUrl: "https://vvvion.space/app/vvvion-space-2.4.0.apk",
    changelog: "hi",
    force: false,
  });
  assert.deepEqual(Object.keys(doc), ["versionCode", "versionName", "apkUrl", "changelog", "force"]);
});

test("windows publish, updater, range and drop", { timeout: 60_000 }, async () => {
  const { sql, close } = await db();
  try {
  const store = memoryReleaseStore();
  const none = await desktopUpdate(sql, ask("/api/app/desktop/update/windows/x86_64/0.1.0"));
  assert.equal(none.status, 204);
  assert.equal(none.headers.get("cache-control"), "no-store");
  assert.equal(await none.text(), "");

  const junk = "not-a-signature";
  await assert.rejects(
    () => desktopBegin(sql, store, { version: "0.2.0", signature: junk, size: 1024 * 1024, changelog: "x" }),
    (error: Error) => error.message === "Подпись не подходит" && !error.message.includes(junk),
  );
  await assert.rejects(
    () => desktopBegin(sql, store, { version: "0.2.0", signature: SIG, size: 1000, changelog: "" }),
    (error: Error) => error.message === "Файл пустой или больше 150 МБ",
  );

  const bad = installer();
  bad[0] = 0x50;
  bad[1] = 0x4b;
  const began = await desktopBegin(sql, store, { version: "0.2.0", signature: SIG, size: bad.byteLength, changelog: "" });
  assert.equal(began.status, 200);
  await assert.rejects(
    () => desktopChunk(sql, store, { index: 0, data: bad.subarray(0, 16).toString("base64") }),
    (error: Error) => error.message === "Это не установщик Windows",
  );

  const file = installer();
  await publish(sql, store, "0.2.0", file, "• Что нового");
  await assert.rejects(
    () => desktopBegin(sql, store, { version: "0.2.0", signature: SIG, size: file.byteLength, changelog: "" }),
    (error: Error) => error.message === "Версия должна быть больше опубликованной",
  );
  await assert.rejects(
    () => desktopBegin(sql, store, { version: "0.1.0", signature: SIG, size: file.byteLength, changelog: "0.1.0" }),
    (error: Error) => error.message === "Версия должна быть больше опубликованной" && !error.message.includes("0.1.0"),
  );

  const fresh = await desktopUpdate(sql, ask("/api/app/desktop/update/windows/x86_64/0.1.0"));
  assert.equal(fresh.status, 200);
  assert.equal(fresh.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(fresh.headers.get("cache-control"), "no-store");
  const payload = (await fresh.json()) as { version: string; notes: string; pub_date: string; url: string; signature: string };
  assert.deepEqual(Object.keys(payload), ["version", "notes", "pub_date", "url", "signature"]);
  assert.equal(payload.version, "0.2.0");
  assert.equal(payload.notes, "• Что нового");
  assert.match(payload.pub_date, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(payload.url, "https://vvvion.space/app/desktop/vvvion-space-desktop-0.2.0-x64-setup.exe");
  assert.equal(payload.signature, SIG);

  for (const path of [
    "/api/app/desktop/update/windows/x86_64/0.2.0",
    "/api/app/desktop/update/windows/x86_64/0.3.0",
    "/api/app/desktop/update/linux/x86_64/0.1.0",
    "/api/app/desktop/update/windows/aarch64/0.1.0",
    "/api/app/desktop/update/windows/x86_64/abc",
  ]) {
    const res = await desktopUpdate(sql, ask(path));
    assert.equal(res.status, 204, path);
    assert.equal(await res.text(), "", path);
  }

  const name = exeName("0.2.0");
  const part = await desktopBytes(sql, store, new Request(`https://vvvion.space/app/desktop/${name}`, { headers: { range: "bytes=0-99" } }), name);
  assert.equal(part.status, 206);
  const head = new Uint8Array(await part.arrayBuffer());
  assert.equal(head.byteLength, 100);
  assert.equal(head[0], 0x4d);
  assert.equal(head[1], 0x5a);
  assert.equal(part.headers.get("content-type"), "application/octet-stream");
  assert.equal(part.headers.get("content-length"), "100");
  assert.equal(part.headers.get("accept-ranges"), "bytes");
  assert.match(part.headers.get("content-disposition") || "", /attachment; filename="vvvion-space-desktop-0\.2\.0-x64-setup\.exe"/);
  assert.equal(part.headers.get("x-content-type-options"), "nosniff");

  const headersOnly = await desktopBytes(sql, store, new Request(`https://vvvion.space/app/desktop/${name}`, { method: "HEAD" }), name);
  assert.equal(headersOnly.status, 200);
  assert.equal(headersOnly.headers.get("content-length"), String(file.byteLength));
  assert.equal(headersOnly.headers.get("accept-ranges"), "bytes");
  assert.equal(await headersOnly.arrayBuffer().then((buf) => buf.byteLength), 0);

  const full = await desktopBytes(sql, store, ask(`/app/desktop/${name}`), name);
  const got = Buffer.from(await full.arrayBuffer());
  assert.equal(createHash("sha256").update(got).digest("hex"), createHash("sha256").update(file).digest("hex"));
  const latest = await desktopLatest(sql, ask("/app/desktop/latest"));
  assert.equal(latest.status, 302);
  assert.equal(latest.headers.get("location"), `https://vvvion.space/app/desktop/${name}`);

  const dropped = await desktopDrop(sql, store);
  assert.equal(dropped.status, 200);
  const after = await desktopUpdate(sql, ask("/api/app/desktop/update/windows/x86_64/0.1.0"));
  assert.equal(after.status, 204);
  assert.equal(store.objects.size, 0);
  const missing = await desktopLatest(sql, ask("/app/desktop/latest"));
  assert.equal(missing.status, 404);
  await assert.rejects(
    () => desktopBegin(sql, store, { version: "0.2.0", signature: SIG, size: file.byteLength, changelog: "" }),
    /больше/,
  );

  const next = installer(0x22);
  await publish(sql, store, "0.10.0", next);
  const jumped = await desktopUpdate(sql, ask("/api/app/desktop/update/windows/x86_64/0.9.0"));
  assert.equal(jumped.status, 200);
  assert.equal(((await jumped.json()) as { version: string }).version, "0.10.0");
  } finally {
    await close();
  }
});

test("old android chunks and new object storage still serve ranges", async () => {
  const { sql, close } = await db();
  try {
  const apk = Buffer.from([0x50, 0x4b, 3, 4, 9, 8, 7, 6, 5, 4]);
  await sql`
    insert into app_release (slot, version_code, version_name, file_name, changelog, force_update, size, received, next_idx, ready, storage)
    values (1, 6, '2.4.0', 'vvvion-space-2.4.0.apk', 'hi', false, ${apk.byteLength}, ${apk.byteLength}, 1, true, 'db')
  `;
  await sql`
    insert into app_release_chunks (slot, idx, data, bytes)
    values (1, 0, ${apk.toString("base64")}, ${apk.byteLength})
  `;
  const ranged = await streamStoredApk(sql, new Request("https://vvvion.space/app/vvvion-space-2.4.0.apk", { headers: { range: "bytes=0-3" } }), {
    slot: 1,
    file_name: "vvvion-space-2.4.0.apk",
    size: apk.byteLength,
  });
  assert.equal(ranged.status, 206);
  assert.deepEqual([...new Uint8Array(await ranged.arrayBuffer())], [0x50, 0x4b, 3, 4]);
  assert.equal(ranged.headers.get("content-type"), "application/vnd.android.package-archive");
  assert.equal(ranged.headers.get("accept-ranges"), "bytes");

  const store = memoryReleaseStore();
  await store.put("vvvion-releases/android/1/0", apk);
  const object = await streamObject(
    store,
    "vvvion-releases/android/1",
    "vvvion-space-2.4.0.apk",
    apk.byteLength,
    new Request("https://vvvion.space/app/vvvion-space-2.4.0.apk", { headers: { range: "bytes=0-1" } }),
    "application/vnd.android.package-archive",
  );
  assert.equal(object.status, 206);
  assert.deepEqual([...new Uint8Array(await object.arrayBuffer())], [0x50, 0x4b]);
  assert.equal(object.headers.get("content-length"), "2");
  } finally {
    await close();
  }
});
