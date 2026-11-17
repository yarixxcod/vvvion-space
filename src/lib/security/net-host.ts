export function hostMatches(host: string, domain: string): boolean {
  const name = host
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
  const root = domain.toLowerCase().replace(/\.$/, "");
  return name === root || name.endsWith(`.${root}`);
}

export function hostInList(host: string, domains: readonly string[]): boolean {
  return domains.some((domain) => hostMatches(host, domain));
}
