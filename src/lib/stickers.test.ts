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
