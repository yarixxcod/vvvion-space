import assert from "node:assert/strict";
import test from "node:test";
import { androidUserAgent, desktopUserAgent, windowsShellFrom } from "./desktop-shell.ts";

test("windows client token is a product, not a substring", () => {
  assert.equal(desktopUserAgent("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 VVVionDesktop/0.2.2"), true);
  assert.equal(desktopUserAgent("VVVionDesktop/1"), true);
  assert.equal(desktopUserAgent("VVVionDesktop/10.4.2-beta Edg/120"), true);
  assert.equal(desktopUserAgent("Mozilla/5.0"), false);
  assert.equal(desktopUserAgent("notVVVionDesktop/0.2.2"), false);
  assert.equal(desktopUserAgent("VVVionDesktop/"), false);
  assert.equal(desktopUserAgent("VVVionDesktop/beta"), false);
});

test("android webview is not the windows shell", () => {
  assert.equal(androidUserAgent("Mozilla/5.0 vvvionApp/3.0.7"), true);
  assert.equal(windowsShellFrom("Mozilla/5.0 vvvionApp/3.0.7 VVVionDesktop/0.2.2"), false);
  assert.equal(windowsShellFrom("Mozilla/5.0"), false);
  assert.equal(windowsShellFrom("Mozilla/5.0", { isDesktop: true, platform: "windows" }), true);
  assert.equal(windowsShellFrom("Mozilla/5.0", { isDesktop: true, platform: "linux" }), false);
  assert.equal(windowsShellFrom("Mozilla/5.0 vvvionApp/1", { isDesktop: true, platform: "windows" }), false);
});
