export const DISK_ID = /^[A-Za-z0-9_-]{16,64}$/;

export function diskPath(id: string): string {
  return `/api/disk/${id}`;
}

export function isDiskPath(value: string): boolean {
  return /^\/api\/disk\/[A-Za-z0-9_-]{16,64}$/.test(value);
}
