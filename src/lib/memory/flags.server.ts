export function memoryFlagEnabled() {
  return process.env.VVVION_MEMORY_ENABLED === "true";
}
export function memoryFeatureFor(userId: string) {
  if (!memoryFlagEnabled()) return false;
  const users = (process.env.VVVION_MEMORY_USERS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return users.includes("*") || users.includes(userId);
}
