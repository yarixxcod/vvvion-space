export function peelQuestionLike(text: string): { text: string; like: boolean } {
  const like = /\[\[like\]\]/i.test(text);
  let clean = text.replace(/[ \t]*\[\[like\]\][ \t]*/gi, "");
  clean = clean.replace(/[ \t]*\[\[(?:l(?:i(?:k(?:e\]?)?)?)?)?$/i, "");
  clean = clean.replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
  return { text: clean, like };
}
