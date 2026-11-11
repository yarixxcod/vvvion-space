/** First two decimal digits, no float. "50" and "50.00" are the same number of cents. */
export function toCents(value: string | number | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return null;
  try {
    const whole = BigInt(match[1]);
    const frac = (match[2] ?? "").slice(0, 2).padEnd(2, "0");
    return whole * 100n + BigInt(frac || "0");
  } catch {
    return null;
  }
}

export function rubAmount(rub: number): string {
  if (!Number.isInteger(rub) || rub < 0) throw new Error("bad_rub");
  return `${rub}.00`;
}
