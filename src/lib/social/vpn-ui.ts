export type VpnPlatform = "android" | "apple" | "desktop";
export type VpnLocale = "ru" | "en" | "kk";
export function vpnPlatform(ua: string): VpnPlatform {
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod|macintosh.*mobile/i.test(ua)) return "apple";
  return "desktop";
}
const countries: Record<string, string> = {
  россия: "RU",
  russia: "RU",
  казахстан: "KZ",
  kazakhstan: "KZ",
  германия: "DE",
  germany: "DE",
  нидерланды: "NL",
  netherlands: "NL",
  финляндия: "FI",
  finland: "FI",
  франция: "FR",
  france: "FR",
  сша: "US",
  usa: "US",
  "united states": "US",
  великобритания: "GB",
  "united kingdom": "GB",
  uk: "GB",
  турция: "TR",
  turkey: "TR",
  швеция: "SE",
  sweden: "SE",
  польша: "PL",
  poland: "PL",
  сингапур: "SG",
  singapore: "SG",
  япония: "JP",
  japan: "JP",
  узбекистан: "UZ",
  uzbekistan: "UZ",
  кыргызстан: "KG",
  kyrgyzstan: "KG",
  швейцария: "CH",
  switzerland: "CH",
  канада: "CA",
  canada: "CA",
  армения: "AM",
  armenia: "AM",
  грузия: "GE",
  georgia: "GE",
  эстония: "EE",
  estonia: "EE",
  латвия: "LV",
  latvia: "LV",
  литва: "LT",
  lithuania: "LT",
};
export function countryFlag(name: string) {
  const value = name.trim().toLowerCase();
  const code = countries[value] || (/^[a-z]{2}$/.test(value) ? value.toUpperCase() : "");
  return code
    ? [...code].map((c) => String.fromCodePoint(127397 + c.charCodeAt(0))).join("")
    : "🌐";
}
export function vpnRelative(value: string | null, lang: VpnLocale, now = Date.now()) {
  const time = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) return { ru: "нет данных", en: "no data", kk: "дерек жоқ" }[lang];
  const minutes = Math.floor(Math.max(0, now - time) / 60000);
  const format = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  return minutes < 60
    ? format.format(-minutes, "minute")
    : minutes < 1440
      ? format.format(-Math.floor(minutes / 60), "hour")
      : format.format(-Math.floor(minutes / 1440), "day");
}
export function vpnDeepLink(app: string, url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash)
      return null;
  } catch {
    return null;
  }
  if (app === "karing") return `karing://install-config?url=${encodeURIComponent(url)}&name=VVVION`;
  if (app === "hiddify") return `hiddify://import/${url}#VVVION`;
  // No unverified Happ/Incy schemes.
  return null;
}
export function vpnApps(platform: VpnPlatform) {
  const happ = {
    id: "happ",
    name: "Happ",
    install:
      platform === "android"
        ? "https://play.google.com/store/apps/details?id=com.happproxy"
        : platform === "apple"
          ? "https://apps.apple.com/us/app/happ-proxy-utility/id6504287215"
          : "https://www.happ.su/main",
  };
  const karing = {
    id: "karing",
    name: "Karing",
    install:
      platform === "apple"
        ? "https://apps.apple.com/us/app/karing/id6472431552"
        : "https://karing.app/en/download",
  };
  const hiddify = { id: "hiddify", name: "Hiddify", install: "https://hiddify.com/app/" };
  return platform === "apple" ? [karing, happ, hiddify] : [hiddify, karing, happ];
}
export function vpnServiceStatus(
  places: { reach: string; maintenance: boolean }[],
): "empty" | "ok" | "partial" | "maintenance" {
  if (!places.length) return "empty";
  const up = places.filter((p) => !p.maintenance && p.reach === "up").length;
  return up === places.length ? "ok" : up > 0 ? "partial" : "maintenance";
}
