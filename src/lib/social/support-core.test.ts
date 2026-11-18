import assert from "node:assert/strict";
import test from "node:test";
import {
  REPORT_HOUR_LIMIT,
  TICKET_DAY_LIMIT,
  canReopen,
  categoryOf,
  imagePayload,
  reasonOf,
  reportAllowed,
  sanctionFits,
  snapshotOf,
  ticketAllowed,
} from "./support-core.ts";

test("unknown category and reason are rejected", () => {
  assert.throws(() => categoryOf("nope"), /категор/);
  assert.throws(() => reasonOf(""), /причин/);
  assert.equal(categoryOf("pay"), "pay");
  assert.equal(reasonOf("spam"), "spam");
});

test("report rate limit and a duplicate open report", () => {
  assert.equal(reportAllowed(0, false), null);
  assert.match(reportAllowed(REPORT_HOUR_LIMIT, false) ?? "", /много/);
  assert.match(reportAllowed(1, true) ?? "", /уже/);
});

test("ticket day limit", () => {
  assert.equal(ticketAllowed(TICKET_DAY_LIMIT - 1), null);
  assert.match(ticketAllowed(TICKET_DAY_LIMIT) ?? "", /много/);
});

test("snapshot clips length and drops control bytes", () => {
  assert.equal(snapshotOf("a".repeat(400)).length, 280);
  assert.equal(snapshotOf("a\u0000b"), "a b");
  assert.equal(snapshotOf(12), "");
});

test("hide and delete fit only posts", () => {
  assert.equal(sanctionFits("hide_post", "post"), true);
  assert.equal(sanctionFits("delete_post", "message"), false);
  assert.equal(sanctionFits("delete_post", "user"), false);
  assert.equal(sanctionFits("ban", "user"), true);
  assert.equal(sanctionFits("warn", "message"), true);
  assert.equal(sanctionFits("nope", "post"), false);
});

test("screenshots must be small jpeg png or webp", () => {
  assert.equal(imagePayload("image/svg+xml", "PHN2Zy8+" + "A".repeat(40)), null);
  assert.equal(imagePayload("image/png", "not-a-png-header!!!!!!"), null);
  assert.equal(imagePayload("image/png", "iVBORw0KGgo"), null);
  assert.equal(imagePayload("image/png", "iVBORw0KGgo" + "A".repeat(280_000)), null);
  assert.equal(imagePayload("image/png", "iVBORw0KGgo" + "A".repeat(20))?.mime, "image/png");
  assert.equal(imagePayload("image/jpeg", "/9j/" + "A".repeat(30))?.mime, "image/jpeg");
  assert.equal(imagePayload("image/webp", "UklGR" + "A".repeat(24))?.mime, "image/webp");
});

test("only solved or closed tickets reopen", () => {
  assert.equal(canReopen("closed"), true);
  assert.equal(canReopen("solved"), true);
  assert.equal(canReopen("open"), false);
  assert.equal(canReopen("new"), false);
});
