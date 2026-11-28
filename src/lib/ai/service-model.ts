/** Reserved IDs keep internal providers out of every public catalogue. No schema migration. */
export const SERVICE_PREFIX = "service:";
export type ServicePurpose = "chat" | "embedding" | "rerank" | "internal";
export function isServiceModel(name: string) {
  return name.toLowerCase().startsWith(SERVICE_PREFIX);
}
export function servicePurpose(name: string): ServicePurpose {
  const kind = name.split(":")[1];
  return isServiceModel(name) && ["embedding", "rerank", "internal"].includes(kind)
    ? (kind as ServicePurpose)
    : isServiceModel(name)
      ? "internal"
      : "chat";
}
export function serviceModelName(name: string, purpose: ServicePurpose) {
  const base = name.replace(/^service:[^:]+:/i, "");
  return purpose === "chat" ? base : `service:${purpose}:${base}`.slice(0, 80);
}
