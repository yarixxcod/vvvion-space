export function tinyfishKey(): string {
  const fromEnv = (process.env.TINYFISH_API_KEY || "").trim();
  return fromEnv;
}
