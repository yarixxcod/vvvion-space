let active = "";

export function readLivePersona(): string {
  return active;
}

export function writeLivePersona(id: string | null): void {
  active = id && /^[a-z0-9-]{2,40}$/.test(id) ? id : "";
}
