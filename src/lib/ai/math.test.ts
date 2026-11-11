import assert from "node:assert/strict";
import { test } from "node:test";
import katex from "katex";
import { fenceAscii } from "../ascii.ts";
import { prepareMath } from "./math.ts";

const SAMPLE = [
  "Нормальный диапазон ИМТ — $18{.}5\\!-\\!24{.}9$.",
  "",
  "примерно: $$",
  "W_{\\min}=18{.}5\\times1{.}88^2\\approx65 \\\\",
  "W_{\\max}=24{.}9\\times1{.}88^2\\approx88 \\\\",
  "$$ Вы сейчас ~84 кг.",
  "",
  "потеря $5\\%$ массы уже полезна.",
].join("\n");

test("chat formulas are math, not an ascii drawing", () => {
  const fenced = fenceAscii(SAMPLE);
  assert.equal(fenced.includes("```ascii"), false);
  const prepared = prepareMath(fenced);
  const block = prepared.slots.find((slot) => slot.display);
  const inline = prepared.slots.filter((slot) => !slot.display);
  assert.ok(block);
  assert.equal(inline.length, 2);
  assert.match(block.tex, /\\begin\{aligned\}/);
  assert.ok(inline.some((slot) => /18\{\.\}5/.test(slot.tex)));
  assert.ok(inline.some((slot) => /\\%/.test(slot.tex)));
  assert.equal(prepared.text.includes("$$"), false);
  for (const slot of prepared.slots) {
    const html = katex.renderToString(slot.tex, { throwOnError: true, displayMode: slot.display });
    assert.match(html, /katex/);
  }
});

test("prices stay text and a drawing stays a drawing", () => {
  const price = prepareMath("Билет стоит $18 и ещё $24.");
  assert.equal(price.slots.length, 0);
  const art = ["┌──┐", "│ok│", "└──┘"].join("\n");
  assert.match(fenceAscii(art), /```ascii/);
});

test("html with dense css stays a code fence", () => {
  const body = ["<!DOCTYPE html>", "<style>", ":root { --bg: #fdf8f3; }", "* { margin: 0; padding: 0; box-sizing: border-box; }", "body { color: #222; }", "</style>"].join("\n");
  const open = "```html\n" + body;
  assert.equal(fenceAscii(open).includes("```ascii"), false);
  assert.match(fenceAscii(open), /```html/);
  const closed = open + "\n```\n";
  assert.equal(fenceAscii(closed).includes("```ascii"), false);
  assert.match(fenceAscii(closed), /```html/);
});
