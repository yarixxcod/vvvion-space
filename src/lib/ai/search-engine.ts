export const SEARCH_ENGINES = [
  { id: "duck", label: "DuckDuckGo" },
  { id: "tinyfish", label: "TinyFish" },
  { id: "freeserp", label: "FreeSERP" },
] as const;

export type SearchEngine = (typeof SEARCH_ENGINES)[number]["id"];

export function isSearchEngine(value: string | null | undefined): value is SearchEngine {
  return value === "duck" || value === "tinyfish" || value === "freeserp";
}

export function searchEngineLabel(engine: SearchEngine): string {
  return SEARCH_ENGINES.find((item) => item.id === engine)?.label ?? "DuckDuckGo";
}
