import assert from "node:assert/strict";
import { test } from "node:test";
import { openMemory, sealMemory } from "./memory-seal.server.ts";

test("memory is unreadable without the server key and plaintext schema still opens", () => {
  const secret = "test-key";
  const json = JSON.stringify({ schemaVersion: 2, entries: [{ text: "Имя: Ярик" }] });
  const sealed = sealMemory(json, secret);
  assert.equal(sealed.includes("Имя"), false);
  assert.equal(openMemory(sealed, secret), json);
  assert.throws(() => openMemory(sealed, "other-key"));
  const plain = JSON.stringify({ schemaVersion: 2, revision: 1, entries: [] });
  assert.equal(openMemory(plain, secret), plain);
});
