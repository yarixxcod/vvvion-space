import assert from "node:assert/strict";
import { test } from "node:test";
import { widgetPayload } from "./widgets.ts";

test("widget payload is only balance and at most eight cities", () => {
  const row = widgetPayload(12.5, ["Алматы", "", "Астана", "Шымкент", "Актау", "Атырау", "Павлодар", "Костанай", "Уральск", "Тараз"]);
  assert.deepEqual(Object.keys(row).sort(), ["balance", "weatherCities"]);
  assert.equal(row.balance, 12.5);
  assert.equal(row.weatherCities.length, 8);
  assert.equal(row.weatherCities[0], "Алматы");
  assert.equal(widgetPayload(Number.NaN, []).balance, 0);
});
