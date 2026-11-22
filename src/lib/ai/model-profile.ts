export type ModelProfile = {
  tools: "native" | "json";
  core: "full" | "lite";
  maxOutputTokens: number;
  parallelCalls: boolean;
  reasoning: { first: "low" | "medium"; rest: "low" | "medium" };
};

export function modelProfile(model: string, providerKind: "builtin" | "custom" = "builtin"): ModelProfile {
  const name = model.toLowerCase();
  const known = /grok|deepseek|qwen|ernie/.test(name);
  const weak = providerKind === "custom" && !known;
  if (/ernie/.test(name) || weak) {
    return { tools: "json", core: "lite", maxOutputTokens: 8192, parallelCalls: false, reasoning: { first: "low", rest: "low" } };
  }
  if (/deepseek|qwen/.test(name)) {
    return { tools: "native", core: "full", maxOutputTokens: 8192, parallelCalls: true, reasoning: { first: "low", rest: "low" } };
  }
  return { tools: "native", core: "full", maxOutputTokens: 16384, parallelCalls: true, reasoning: { first: "medium", rest: "low" } };
}
