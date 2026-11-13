const MIN_KEY = 32;

export function captchaKey(value = process.env.ALTCHA_HMAC_KEY): string | null {
  const key = value?.trim();
  if (!key || key.length < MIN_KEY) return null;
  return key;
}

export function takeCaptchaHash(hash: string, seen: Set<string>): boolean {
  if (seen.has(hash)) return false;
  seen.add(hash);
  return true;
}
