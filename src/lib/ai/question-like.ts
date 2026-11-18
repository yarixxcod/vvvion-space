export function peelQuestionLike(text: string): { text: string; like: boolean } {
  if (!/\[\[like\]\]/i.test(text)) return { text, like: false };
  const clean = text.replace(/[ \t]*\[\[like\]\][ \t]*/gi, "").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
  return { text: clean, like: true };
}
