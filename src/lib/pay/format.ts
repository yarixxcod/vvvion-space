export function fmtVub(n: number): string {
  const v = Math.trunc(Number.isFinite(n) ? n : 0);
  return `${v.toLocaleString("ru-RU")} вуб`;
}

/** Approximate ruble price of a vuble balance: 10 vub ≈ 1 ₽. Display only. */
export function fmtRubApprox(vub: number): string {
  const rub = (Number.isFinite(vub) ? vub : 0) / 10;
  return `≈ ${rub.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ₽`;
}
