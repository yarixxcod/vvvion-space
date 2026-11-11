const WHOLE = /^(?:[1-9]\d{0,4}|100000)$/;

/** Whole vubles from 1 to 100000. Anything else, including a rewritten "-5" or "1.5", is rejected. */
export function wholeVubles(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 1 || value > 100_000) return null;
    return value;
  }
  if (typeof value === "string" && WHOLE.test(value)) return Number(value);
  return null;
}

export type SumHint = "empty" | "funds" | "debt" | "ok";

/** Transfer is allowed only when the amount is a whole sum and does not exceed the balance. */
export function transferHint(raw: string, balance: number): SumHint {
  const sum = wholeVubles(raw.trim());
  if (sum == null) return "empty";
  if (sum > balance) return "funds";
  return "ok";
}

/** A partial repayment cannot exceed the debt or the balance. */
export function repayHint(raw: string, balance: number, left: number): SumHint {
  const sum = wholeVubles(raw.trim());
  if (sum == null) return "empty";
  if (sum > left) return "debt";
  if (sum > balance) return "funds";
  return "ok";
}