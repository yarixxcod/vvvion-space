export const DOCUMENT_MAX = 3 * 1024 * 1024;
export const TEXT_MAX = 1024 * 1024;
export function documentKind(name: string): "text" | "docx" | null {
  if (/\.docx$/i.test(name)) return "docx";
  return /\.(txt|md|markdown|html?|css|js|mjs|cjs|jsx|ts|tsx|json|csv|log|xml|svg|ya?ml|toml|ini|sql|py|sh|env|gitignore)$/i.test(
    name,
  )
    ? "text"
    : null;
}
export function documentMime(name: string) {
  return /\.docx$/i.test(name)
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : /\.html?$/i.test(name)
      ? "text/html;charset=utf-8"
      : /\.css$/i.test(name)
        ? "text/css;charset=utf-8"
        : /\.[mc]?js$/i.test(name)
          ? "text/javascript;charset=utf-8"
          : /\.json$/i.test(name)
            ? "application/json"
            : /\.md$/i.test(name)
              ? "text/markdown;charset=utf-8"
              : "text/plain;charset=utf-8";
}

export const isSiteAsset = (name: string) =>
  /\.(html?|css|[mc]?js|json|txt|csv|md|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|otf)$/i.test(name);
