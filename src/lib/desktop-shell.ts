/** Product token the Windows client appends to the WebView2 user agent. Version changes per release. */
export const DESKTOP_UA_SOURCE = "(?:^|\\s)VVVionDesktop\\/[0-9][^\\s]*(?=\\s|$)";

const DESKTOP_UA = new RegExp(DESKTOP_UA_SOURCE, "u");
const ANDROID_UA = /(?:^|\s)vvvionApp\/[^\s]*/u;

export function desktopUserAgent(ua: string): boolean {
  return DESKTOP_UA.test(ua);
}

export function androidUserAgent(ua: string): boolean {
  return ANDROID_UA.test(ua);
}

/** Layout-only. Does not grant auth or permissions. Android keeps the phone layout. */
export function windowsShellFrom(ua: string, bridge?: { isDesktop?: boolean; platform?: string } | null): boolean {
  if (androidUserAgent(ua)) return false;
  if (desktopUserAgent(ua)) return true;
  return bridge?.isDesktop === true && bridge.platform === "windows";
}
