import assert from "node:assert/strict";
import test from "node:test";
import { repayHint, transferHint, wholeVubles } from "./amount.ts";

test("whole vubles stay between 1 and 100000", () => {
  assert.equal(wholeVubles("0"), null);
  assert.equal(wholeVubles("-5"), null);
  assert.equal(wholeVubles("1.5"), null);
  assert.equal(wholeVubles(""), null);
  assert.equal(wholeVubles("12"), 12);
  assert.equal(wholeVubles(100000), 100000);
});

test("transfer button state", () => {
  assert.equal(transferHint("", 500), "empty");
  assert.equal(transferHint("0", 500), "empty");
  assert.equal(transferHint("-3", 500), "empty");
  assert.equal(transferHint("501", 500), "funds");
  assert.equal(transferHint("500", 500), "ok");
});

test("repay stays inside the debt and the balance", () => {
  assert.equal(repayHint("", 800, 400), "empty");
  assert.equal(repayHint("401", 800, 400), "debt");
  assert.equal(repayHint("300", 200, 400), "funds");
  assert.equal(repayHint("200", 800, 400), "ok");
});
