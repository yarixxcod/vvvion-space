import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { httpUrl } from "./search-rank.ts";
type Node = {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  identifier?: string;
  ordered?: boolean;
  start?: number;
  checked?: boolean | null;
  children?: Node[];
};
const parser = unified().use(remarkParse).use(remarkGfm);
/** Copy prose as readable text. Code/inline-code content is intentionally lossless. */
export function markdownPlainText(source: string): string {
  const tree = parser.parse(source) as Node;
  const definitions = new Map<string, string>();
  for (const node of tree.children || [])
    if (node.type === "definition" && node.identifier && node.url)
      definitions.set(node.identifier.toLowerCase(), node.url);
  function text(node: Node): string {
    const inner = () => (node.children || []).map(text).join("");
    switch (node.type) {
      case "text":
      case "inlineCode":
      case "code":
        return node.value || "";
      case "break":
        return "\n";
      case "root":
        return (node.children || []).map(text).filter(Boolean).join("\n\n");
      case "heading":
      case "paragraph":
      case "strong":
      case "emphasis":
      case "delete":
        return inner();
      case "blockquote":
        return (node.children || []).map(text).join("\n\n");
      case "list":
        return (node.children || [])
          .map((item, i) => {
            const lines = text(item).split("\n");
            const bullet = node.ordered ? `${(node.start || 1) + i}. ` : "- ";
            return bullet + lines.map((line, j) => (j ? "  " + line : line)).join("\n");
          })
          .join("\n");
      case "listItem":
        return (
          (typeof node.checked === "boolean" ? (node.checked ? "[x] " : "[ ] ") : "") +
          (node.children || []).map(text).join("\n")
        );
      case "link":
      case "linkReference": {
        const label = inner();
        const url = httpUrl(node.url || definitions.get((node.identifier || "").toLowerCase()));
        return url && url !== label ? `${label} (${url})` : label;
      }
      case "image":
      case "imageReference": {
        const url = httpUrl(node.url || definitions.get((node.identifier || "").toLowerCase()));
        return [node.alt || "Изображение", url ? `(${url})` : ""].filter(Boolean).join(" ");
      }
      case "table":
        return (node.children || []).map(text).join("\n");
      case "tableRow":
        return (node.children || []).map(text).join("\t");
      case "definition":
        return "";
      case "thematicBreak":
        return "—";
      case "html":
        return (node.value || "").replace(/<[^>]*>/g, "");
      default:
        return inner();
    }
  }
  return text(tree);
}
