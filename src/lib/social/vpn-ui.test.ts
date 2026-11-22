import test from "node:test";
import assert from "node:assert/strict";
import {
  countryFlag,
  vpnPlatform,
  vpnDeepLink,
  vpnRelative,
  vpnApps,
  vpnServiceStatus,
} from "./vpn-ui.ts";
test("VPN platform and flag helpers include iPad desktop mode and safe unknown country", () => {
  assert.equal(vpnPlatform("Mozilla Android"), "android");
  assert.equal(vpnPlatform("Macintosh Mobile"), "apple");
  assert.equal(vpnPlatform("Linux"), "desktop");
  assert.equal(countryFlag("Германия"), "🇩🇪");
  assert.equal(countryFlag("Kazakhstan"), "🇰🇿");
  assert.equal(countryFlag("RU"), "🇷🇺");
  assert.equal(countryFlag("unknown"), "🌐");
  assert.equal(vpnApps("apple")[0].id, "karing");
});
test("VPN deeplinks follow verified encoding and never accept executable or unverified schemes", () => {
  const u = "https://vvvion.space/api/vpn/testToken?x=1&y=2";
  assert.equal(new URL(vpnDeepLink("karing", u)!).searchParams.get("url"), u);
  assert.equal(vpnDeepLink("hiddify", u), `hiddify://import/${u}#VVVION`);
  for (const app of ["happ", "incy", "unknown"]) assert.equal(vpnDeepLink(app, u), null);
  assert.equal(vpnDeepLink("karing", "javascript:alert(1)"), null);
});
test("VPN time is localized and state reports partial availability", () => {
  const now = Date.parse("2026-11-22T00:05:00Z"),
    at = "2026-11-22T00:00:00Z";
  assert.match(vpnRelative(at, "en", now), /5 minutes ago/);
  assert.match(vpnRelative(at, "ru", now), /5 минут назад/);
  assert.notEqual(vpnRelative(at, "kk", now), vpnRelative(at, "ru", now));
  assert.equal(vpnServiceStatus([]), "empty");
  assert.equal(vpnServiceStatus([{ reach: "up", maintenance: false }]), "ok");
  assert.equal(
    vpnServiceStatus([
      { reach: "down", maintenance: false },
      { reach: "up", maintenance: false },
    ]),
    "partial",
  );
});
