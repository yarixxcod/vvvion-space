import assert from "node:assert/strict";
import { test } from "node:test";
import { markdownChunks, stabilizeMarkdown as stable } from "./stream-markdown.ts";
test("complete the live fence without modifying literal Markdown inside", () => {
  assert.equal(stable("```pla"), "");
  assert.equal(stable("```plain\n**literal"), "```plain\n**literal\n```");
  assert.equal(stable("```plain\n**literal\n`"), "```plain\n**literal\n```");
  assert.equal(stable("```plain\n**literal\n```"), "```plain\n**literal\n```");
  assert.equal(stable("~~~~txt\ncode"), "~~~~txt\ncode\n~~~~");
});
test("finish emphasis while streaming and retain ordinary punctuation", () => {
  assert.equal(stable("**bold"), "**bold**");
  assert.equal(stable("**bold*"), "**bold**");
  assert.equal(stable("some_name"), "some_name");
  assert.equal(stable("Text\n\n##"), "Text\n");
});
test("settled chunks do not change as the tail grows; lists and tables stay together", () => {
  const prefix = "## Heading\n\nParagraph\n\n";
  for (const tail of ["tail", "**tail", "```plain\ntext", "| A | B |\n| --- | --- |\n| a | b |"])
    assert.deepEqual(markdownChunks(prefix + tail).slice(0, 2), ["## Heading", "Paragraph"]);
  assert.equal(markdownChunks("- one\n\n- two").length, 1);
  assert.equal(markdownChunks("| A | B |\n| --- | --- |\n| a | b |").length, 1);
  assert.equal(stable("| A | B |"), "");
});
