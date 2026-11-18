import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
function key() {
  const value = process.env.TELEGRAM_TOKEN_KEY || process.env.BETTER_AUTH_SECRET;
  if (!value)
    throw new Error(
      "Для сохранения токена настройте стабильный TELEGRAM_TOKEN_KEY или BETTER_AUTH_SECRET на сервере",
    );
  return createHash("sha256").update(`vvvion.telegram.v1:${value}`).digest();
}
export function sealBotToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${data.toString("base64url")}`;
}
export function openBotToken(value: string): string {
  if (!value.startsWith("enc:")) return value; // Legacy tokens keep working until admin rotates them.
  const [prefix, version, nonce, tag, data] = value.split(":");
  if (prefix !== "enc" || version !== "v1" || !nonce || !tag || !data)
    throw new Error("Сохранённый токен повреждён. Подключите бота заново");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(nonce, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(
      "Не удалось прочитать токен. Проверьте ключ шифрования сервера или подключите бота заново",
    );
  }
}
