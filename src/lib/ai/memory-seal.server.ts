import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export function memoryKeyBytes(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function sealMemory(json: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", memoryKeyBytes(secret), iv);
  const ct = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  return JSON.stringify({
    v: 1,
    alg: "A256GCM",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ct: ct.toString("base64url"),
  });
}

export function openMemory(payload: string, secret: string): string {
  const trimmed = payload.trim();
  if (!trimmed.startsWith("{")) throw new Error("MEMORY_READ_FAILED");
  const parsed = JSON.parse(trimmed) as { schemaVersion?: unknown; alg?: unknown; iv?: unknown; tag?: unknown; ct?: unknown };
  if (parsed.schemaVersion === 2) return trimmed;
  if (parsed.alg !== "A256GCM" || typeof parsed.iv !== "string" || typeof parsed.tag !== "string" || typeof parsed.ct !== "string") {
    throw new Error("MEMORY_READ_FAILED");
  }
  const decipher = createDecipheriv("aes-256-gcm", memoryKeyBytes(secret), Buffer.from(parsed.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(parsed.ct, "base64url")), decipher.final()]).toString("utf8");
}
