/** Literal search: underscores in usernames must never become SQL wildcards. */
export function peopleQuery(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/^@/, "").replace(/\s+/g, " ").slice(0, 80) : "";
}

export function peopleLike(query: string): string {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}
