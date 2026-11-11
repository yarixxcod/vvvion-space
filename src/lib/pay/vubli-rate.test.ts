import assert from "node:assert/strict";
import test from "node:test";
import { minRubForVub, quote, TopupError } from "./vubli-rate.ts";

test("rate steps and bucket split", () => {
  const samples = [
    [50, 480, 480, 0],
    [99, 950, 950, 0],
    [100, 980, 980, 0],
    [499, 4890, 4890, 0],
    [500, 5000, 5000, 0],
    [1000, 10000, 10000, 0],
    [1999, 19990, 19990, 0],
    [2000, 20400, 20000, 400],
    [2500, 25500, 25000, 500],
    [4999, 50989, 49990, 999],
    [5000, 52000, 50000, 2000],
    [10000, 104000, 100000, 4000],
  ] as const;
  for (const [rub, total, purchased, bonus] of samples) {
    const row = quote(rub);
    assert.equal(row.vubliTotal, total, String(rub));
    assert.equal(row.vubliPurchased, purchased, String(rub));
    assert.equal(row.vubliBonus, bonus, String(rub));
    assert.equal(row.vubliPurchased + row.vubliBonus, row.vubliTotal);
    assert.ok(row.vubliPurchased <= rub * 10);
  }
});

test("vubli total never falls as rubles rise", () => {
  let prev = quote(50).vubliTotal;
  for (let rub = 51; rub <= 50000; rub += 1) {
    const total = quote(rub).vubliTotal;
    assert.ok(total >= prev, `${rub}: ${total} < ${prev}`);
    prev = total;
  }
});

test("quote rejects junk amounts", () => {
  for (const rub of [49, 50001, 10.5, Number.NaN, -1, 0]) {
    assert.throws(() => quote(rub), (err: unknown) => err instanceof TopupError && err.code === "amount_out_of_range");
  }
});

test("min rub covers the shortfall", () => {
  assert.equal(minRubForVub(480), 50);
  assert.equal(minRubForVub(481), 51);
  assert.equal(minRubForVub(52000), 5000);
  assert.equal(minRubForVub(9_000_000), 50000);
  const need = 310;
  assert.ok(quote(minRubForVub(need)).vubliTotal >= need);
});
