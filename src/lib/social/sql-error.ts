export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ((err as { code?: unknown }).code === "23505") return true;
  const message = err instanceof Error ? err.message : "";
  return /duplicate key|unique constraint/i.test(message);
}
