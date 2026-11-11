export type SortKey = "date" | "size" | "ext" | "name";
export type SortDir = "asc" | "desc";

export type Sortable = {
  name: string;
  bytes: number;
  createdAt: string;
  folder?: boolean;
};

export function extOf(name: string): string {
  const base = name.split("/").pop() || name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

function timeOf(value: string): number {
  if (!value) return 0;
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

export function matchQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return name.toLowerCase().includes(q) || extOf(name).includes(q);
}

export function compareFiles<T extends Sortable>(items: T[], key: SortKey, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  const by = (a: T, b: T) => {
    let n = 0;
    if (key === "size") n = a.bytes - b.bytes;
    else if (key === "date") n = timeOf(a.createdAt) - timeOf(b.createdAt);
    else if (key === "ext") n = extOf(a.name).localeCompare(extOf(b.name), "ru");
    else n = a.name.localeCompare(b.name, "ru");
    if (n === 0) n = a.name.localeCompare(b.name, "ru");
    return n * sign;
  };
  const folders = items.filter((item) => item.folder).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const files = items.filter((item) => !item.folder).sort(by);
  return [...folders, ...files];
}
