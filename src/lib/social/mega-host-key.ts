import { createHash } from "node:crypto";

export function hostFingerprint(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

export function hostKeyMatches(expected: string, key: Buffer): boolean {
  return expected.startsWith("SHA256:") && hostFingerprint(key) === expected;
}
