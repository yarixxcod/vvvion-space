import { createHmac, timingSafeEqual } from "node:crypto";
function master() {
  return (process.env.VPN_AGENT_TOKEN || process.env.BETTER_AUTH_SECRET || "").trim();
}
export function connectNodeToken(nodeId: string) {
  const key = master();
  if (!key) throw Error("На сервере сайта не задан секрет агента Connect");
  return createHmac("sha256", key)
    .update("vvvion-connect-node-v1:" + nodeId)
    .digest("base64url");
}
export function connectTokenReady() {
  return Boolean(master());
}
export function verifyConnectToken(header: string | null, nodeId: string) {
  const token = (header || "").replace(/^Bearer\s+/i, "").trim();
  const equal = (expected: string) => {
    const a = Buffer.from(token),
      b = Buffer.from(expected);
    return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  };
  return (
    connectTokenReady() &&
    (equal(connectNodeToken(nodeId)) ||
      Boolean(process.env.VPN_AGENT_TOKEN?.trim() && equal(process.env.VPN_AGENT_TOKEN.trim())))
  );
}
