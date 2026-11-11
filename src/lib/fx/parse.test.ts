import assert from "node:assert/strict";
import test from "node:test";
import { cleanFx, parseFx } from "./parse.ts";

test("keeps only the board currencies", () => {
  assert.equal(cleanFx("kzt"), "KZT");
  assert.equal(cleanFx(" btc "), null);
  assert.equal(cleanFx(1), null);
});

test("reads how many quote units one base buys", () => {
  const board = parseFx(
    {
      date: "2026-10-30",
      kzt: { usd: 0.002, eur: "0.0018", rub: 0, uzs: 26.5, kgs: 0.19, byn: 0.006, cny: 0.01 },
    },
    "KZT",
  );
  assert.equal(board.date, "2026-10-30");
  assert.deepEqual(
    board.quotes.map((item) => item.code),
    ["USD", "EUR", "UZS", "KGS", "BYN"],
  );
  assert.equal(board.quotes[0]?.perBase, 0.002);
});
