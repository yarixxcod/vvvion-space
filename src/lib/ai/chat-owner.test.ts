import assert from "node:assert/strict";
import { test } from "node:test";
import { localChatAccess } from "./chat-owner.ts";

test("the same account keeps its local chats", () => {
  assert.equal(localChatAccess("user-a", "user-a"), "keep");
});

test("another account does not receive them", () => {
  assert.equal(localChatAccess("user-a", "user-b"), "drop");
});

test("a signed-out visitor does not see an account's local chats", () => {
  assert.equal(localChatAccess("user-a", null), "drop");
  assert.equal(localChatAccess("user-a", ""), "drop");
});

test("guest drafts stay on this browser and join the account that signs in", () => {
  assert.equal(localChatAccess("guest", null), "keep");
  assert.equal(localChatAccess("guest", "user-b"), "adopt");
});

test("untagged leftovers are discarded", () => {
  assert.equal(localChatAccess(null, "user-a"), "drop");
  assert.equal(localChatAccess(null, null), "drop");
});
