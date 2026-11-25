import assert from "node:assert/strict";
import test from "node:test";
import { replaceStickerTokens, stickerChatTitle, stickerMeaning } from "./stickers.ts";

test("sticker chat titles stay human", () => {
  assert.equal(stickerChatTitle("[[sticker:1F354]]"), "Бургер");
  assert.equal(stickerChatTitle("[[sticker:1F64F]]"), "Спасибо");
  assert.equal(stickerChatTitle("[[sticker:no-such-id]]"), "Стикер");
  assert.equal(stickerChatTitle("Обычный диалог"), null);
  assert.equal(replaceStickerTokens("смотри [[sticker:1F44D]]"), "смотри Нравится");
});

test("the model hears the gesture, not the token", () => {
  const known = stickerMeaning("[[sticker:1F64F]]");
  const unknown = stickerMeaning("[[sticker:NOPE]]");
  assert.match(known, /Спасибо/);
  assert.doesNotMatch(known, /1F64F|\[\[sticker/);
  assert.match(unknown, /стикер/i);
  assert.doesNotMatch(unknown, /NOPE|\[\[sticker/);
});

import {
  canonicalSticker,
  isKnownSticker,
  stickerUrl,
  splitStickerContent,
  stickerReplyPolicy,
  stickerReplyGuide,
  normalizeStickerReply,
  StickerTextGate,
  STICKER_PACKS,
} from "./stickers.ts";

test("invented cosmo-cool from the screenshot is repaired, case and harmless separators normalize", () => {
  assert.equal(canonicalSticker("COSMO_COOL"), "cosmo-yes");
  assert.equal(canonicalSticker(" cosmo - cool "), "cosmo-yes");
  assert.equal(stickerUrl("cosmo-cool"), "/stickers/cosmo-yes-v1.webp");
  assert.deepEqual(splitStickerContent("Круто! [[ sticker : COSMO_COOL ]]"), {
    text: "Круто!",
    stickers: ["cosmo-yes"],
  });
  assert.deepEqual(splitStickerContent("Ответ [[sticker:cosmo-invented]]"), {
    text: "Ответ",
    stickers: [],
  });
  assert.equal(stickerUrl("cosmo-invented"), "");
  assert.equal(isKnownSticker("1f600"), true);
  assert.equal(splitStickerContent("Текст [[sticker:cosmo-").text, "Текст");
});

test("winter auto-season uses the local calendar and explicit requests override only the season", () => {
  const ordinary = [{ role: "user", content: "Привет!" }];
  const policy = (date: string, history = ordinary, tz = "UTC") =>
    stickerReplyPolicy(history, new Date(date), tz);
  for (const date of ["2026-11-26", "2026-12-14", "2027-01-11", "2027-07-01"])
    assert.equal(policy(date).allowWinter, false, date);
  for (const date of ["2026-12-15", "2026-12-31", "2027-01-01", "2027-01-10"])
    assert.equal(policy(date).allowWinter, true, date);
  assert.equal(policy("2026-12-14T20:00:00Z", ordinary, "Asia/Almaty").allowWinter, true);
  assert.equal(policy("2027-01-10T20:00:00Z", ordinary, "Asia/Almaty").allowWinter, false);
  const explicit = [{ role: "user", content: "Пришли новогодний стикер с котом" }];
  assert.equal(policy("2026-07-01", explicit).allowWinter, true);
  assert.equal(
    policy("2026-07-01", [{ role: "user", content: "Когда Новый год?" }]).allowWinter,
    false,
  );
  assert.equal(policy("2026-07-01", [...explicit, ...ordinary]).allowWinter, false);
  assert.equal(policy("2026-07-01", ordinary, "not/a-zone").timeZone, "UTC");
  const summer = policy("2026-07-01");
  assert.equal(normalizeStickerReply("Привет [[sticker:winter-hello]]", summer), "Привет ");
  assert.equal(
    normalizeStickerReply("Привет [[sticker:winter-hello]]", {
      ...summer,
      allowWinter: true,
      allowStickers: false,
    }),
    "Привет ",
  );
  assert.deepEqual(splitStickerContent("[[sticker:winter-hello]]").stickers, ["winter-hello"]); // Historical/manual stickers don't disappear out of season.
  assert.doesNotMatch(stickerReplyGuide(ordinary, new Date("2026-11-26")), /\[\[sticker:winter-/);
  assert.match(stickerReplyGuide(ordinary, new Date("2026-12-26")), /\[\[sticker:winter-hello\]\]/);
});

test("stream gate handles every split position, preserves other markup, drops unknown and premature holiday codes", () => {
  const summer = stickerReplyPolicy([], new Date("2026-07-01"));
  const raw =
    "Ответ [[sticker:cosmo-cool]] конец [[sticker:cosmo-no-such]] [[sticker:winter-tree]]";
  for (let i = 0; i <= raw.length; i++) {
    const gate = new StickerTextGate(summer);
    assert.equal(
      gate.push(raw.slice(0, i)) + gate.push(raw.slice(i)) + gate.flush(),
      "Ответ [[sticker:cosmo-yes]] конец  ",
    );
  }
  const gate = new StickerTextGate(summer);
  let out = "";
  for (const char of "A [[like]] B [[ sticker : COSMO_COOL ]] C [[sticker:cosmo-love]]")
    out += gate.push(char);
  out += gate.flush();
  assert.equal(out, "A [[like]] B [[sticker:cosmo-yes]] C ");
  const partial = new StickerTextGate(summer);
  assert.equal(partial.push("Текст [[sti") + partial.flush(), "Текст ");
  const plain = new StickerTextGate(summer);
  assert.equal(plain.push("arr[[i]] и [ссылка](url)") + plain.flush(), "arr[[i]] и [ссылка](url)");
  const denied = new StickerTextGate({ ...summer, allowStickers: false });
  assert.equal(denied.push("[[sticker:cosmo-hello]]") + denied.flush(), "");
});

test("every holiday SKU has a known local asset and an explicit prompt meaning", () => {
  const pack = STICKER_PACKS.find((p) => p.id === "winter");
  assert.ok(pack);
  assert.equal(pack.codes.length, 8);
  for (const code of pack.codes) {
    assert.equal(isKnownSticker(code), true);
    assert.equal(stickerUrl(code), `/stickers/${code}-v1.webp`);
  }
});
