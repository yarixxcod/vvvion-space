/** Off until the account owner explicitly enables disk context in settings. */
export function diskAccessEnabled(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("vv-disk-ai-v1") === "on";
  } catch {
    return false;
  }
}

export function setDiskAccess(enabled: boolean): void {
  try {
    localStorage.setItem("vv-disk-ai-v1", enabled ? "on" : "off");
  } catch {
    /* Private browser storage may be unavailable. */
  }
}
