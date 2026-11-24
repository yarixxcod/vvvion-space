import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../src/", import.meta.url));

function resolveFile(base) {
  if (existsSync(base)) return base;
  for (const ext of [".ts", ".tsx", ".mts", ".mjs", ".js", ".json"]) {
    if (existsSync(base + ext)) return base + ext;
  }
  return base;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return { url: pathToFileURL(resolveFile(path.join(root, specifier.slice(2)))).href, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const target = fileURLToPath(new URL(specifier, context.parentURL));
    if (!existsSync(target)) {
      const file = resolveFile(target);
      if (file !== target) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
