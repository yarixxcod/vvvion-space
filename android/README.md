# VVVion Space Android 3.0.2 (18)

Package: `space.vvvion.app`; Android 7+ (API 24), compile/target SDK 36, Java 17, AGP 8.11.1, Gradle 8.13. Versions are pinned in Gradle and the web lockfile.

## Architecture

A native Java Android host reuses the existing React application over the canonical `https://vvvion.space` origin. Native modules provide Media3 background playback, notification channels/FCM, file capture/selection, Downloads/MediaStore, sharing, clipboard, haptics, widgets, back navigation, keyboard/insets, offline recovery and renderer recovery. Keeping these established modules avoids a Capacitor migration and preserves the site's cookie authentication and same-origin server functions. There is no parallel account, wallet or purchase database.

This is an **online hybrid**, not a fully offline SPA. The SSR HTML and APIs still come from the site. CI packages static resources from its own checkout; those resources are used only when their exact URLs are requested by the site. Shipping an APK does not deploy branch-only backend/UI features. Undeployed registration/gift changes require a separately verified site deployment; APK builds do not use Vercel build quota.

## Reproducible builds

From repository root (Node 22):

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build:web
npm run android:assets
cd android
./gradlew --no-daemon :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

`build:web` compiles without executing database migrations. Android build requires Java 17, Android SDK 36 and Build Tools 35.0.0. Generated assets, build outputs and private configuration are ignored. Android Studio may create ignored `local.properties` for the SDK path. No production database credentials are needed.

Workflow: `.github/workflows/android-hybrid.yml`, limited to `uiux-polish-3.0.1`. Each run checks TypeScript, lint and tests, compiles web resources, runs native unit tests and Android lint, builds debug, verifies APK signatures and uploads named APKs/checksums and reports. Without signing credentials it also compiles an unsigned release to exercise R8, but does not distribute that file as an installable release.

## Signing and push configuration

Configure repository Actions Secrets (never source files):

| Secret | Value |
| --- | --- |
| `VV_KEYSTORE_B64` | Base64 of the **original** release keystore |
| `VV_STORE_PASS` | Keystore password |
| `VV_KEY_ALIAS` | Original signing alias |
| `VV_KEY_PASS` | Key password |
| `VV_FIREBASE_JSON` | Firebase Android client configuration JSON for `space.vvvion.app` |

When all signing secrets exist, CI builds a signed release APK and AAB. Temporary keys/configuration are removed even on failure. Firebase is compiled only when its configuration is supplied; without it **remote push is unavailable**, while local notifications and other modules work. Server-side FCM credentials must also be configured on the existing server. Do not commit either Firebase config or server keys.

Keep the previous release signing key to update installed applications. A new key cannot update an existing installation signed with the old key. Debug builds also cannot update release installations; CI debug certificates may change between runners. Do not uninstall an app with unsynced local chats to work around a signature mismatch. No new release key was generated.

For verified App Links, deploy `/.well-known/assetlinks.json` on the site with package `space.vvvion.app` and the actual release SHA-256 signing certificate fingerprint. The manifest alone cannot verify domain ownership. Do not publish debug fingerprints as release fingerprints.

## Security boundaries

- Only exact canonical HTTPS origin, no userinfo, arbitrary ports or wildcard subdomains.
- Every privileged Java bridge call requires a 256-bit per-navigation capability injected into a top-frame closure. It is never a global JS property, logged or persisted; navigation rotates it. Cross-origin child frames cannot authorize native calls. Same-origin XSS remains a risk and must be prevented by the web application.
- No mixed content, cleartext HTTP, file access, SSL bypass or exported capture provider.
- Session stays with the site's Secure/HttpOnly cookie mechanism in the app-private WebView store; backups disabled. No app-owned bearer token copied into preferences or source.
- Native media strips cookie/authorization headers at every redirect, and adds the session cookie only to canonical `/api/` requests. HTTPS downgrades rejected.
- Authenticated downloads use browser fetch/cookie policy, not Cookie headers forwarded through system download redirects. Blob chunks and full size are validated before publishing files; interrupted sinks are cleaned up.
- External links use an explicit scheme allowlist; `intent:` only accepts an HTTPS fallback, never arbitrary intent extras/components.
- Microphone permission is requested only for a trusted audio capture request. Camera capture uses the system camera app without broad camera/storage permissions.

## Device acceptance still required

A compiled APK and unit tests do not replace an Android device run. Test a release-signed build with a non-admin test account: registration → email code → personalization; login/relaunch/logout; model switching and streamed replies; microphone permission denial/grant; attachment/camera selection; file save/open; back closing sheets then navigation; IME in landscape and on a tablet; light/dark theme; airplane mode/reconnect; background playback; FCM notification on a stopped app; App Links verification; purchases, gift inventory/resale and admin wallet grant against an authorized test environment. Do not mutate real user balances for QA.
