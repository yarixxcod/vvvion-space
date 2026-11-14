package space.vvvion.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * JS interface "VvvionNative" (wrapped on the page as window.VvvionApp by assets/app/vv-bridge.js).
 * Every call requires a per-navigation capability held only in the top-frame JS closure.
 * Cross-origin child frames see the Java object but cannot authorize a call.
 */
final class Bridge {
    private final MainActivity a;
    private String lastCoverKey = ""; private Bitmap lastCover;

    Bridge(MainActivity a) { this.a = a; }

    private boolean ok(String capability) { return MainActivity.trustedPage && a.bridgeCapability.accepts(capability); }

    @JavascriptInterface public void pullToRefresh(String capability, boolean on) { if (ok(capability) && a.ptr != null) a.ptr.setEnabled(on); }

    /** The bridge's back fallback consumed a press but nothing changed within 400 ms: run the app's default back. */
    @JavascriptInterface public void backDefault(String capability) { if (ok(capability)) a.backDefault(); }

    @JavascriptInterface public String perf(String capability) { return ok(capability) ? a.perfJson() : "{}"; }

    @JavascriptInterface public boolean pushAvailable(String capability) { return ok(capability) && PushStore.available(); }
    @JavascriptInterface public String pushToken(String capability) { return ok(capability) ? PushStore.token(a) : ""; }
    @JavascriptInterface public boolean notificationsEnabled(String capability) { return ok(capability) && AppNotifier.canNotify(a); }
    @JavascriptInterface public void requestNotificationPermission(String capability) { if (ok(capability)) a.ui.post(() -> a.askNotifications(true)); }

    @JavascriptInterface public void openNotificationSettings(String capability) {
        if (!ok(capability)) return;
        a.ui.post(() -> {
            try {
                Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, a.getPackageName());
                a.startActivity(i);
            } catch (Exception ignored) {}
        });
    }

    /** JSON: {id, channel, title, body, url, onlyWhenBackground (default true)} */
    @JavascriptInterface public boolean notify(String capability, String json) {
        if (!ok(capability)) return false;
        try {
            JSONObject o = new JSONObject(json);
            return AppNotifier.show(a, o.optString("id", ""), o.optString("channel", "messages"), o.optString("title", ""),
                o.optString("body", ""), o.optString("url", ""), o.optBoolean("onlyWhenBackground", true));
        } catch (Exception e) { return false; }
    }

    @JavascriptInterface public void cancelNotification(String capability, String id) { if (ok(capability)) AppNotifier.cancel(a, id); }

    /** Reported by the injected script: {playing, hasPlayer, title, artist, album, coverKey, cover(dataURL), duration, position, buffering} */
    @JavascriptInterface public void mediaState(String capability, String json) {
        if (!ok(capability)) return;
        try {
            JSONObject o = new JSONObject(json);
            if (NativePlayer.active()) {   // 3.0.0: the native player owns playback; web audio that starts anyway takes over (native stops), silence is ignored
                if (!o.optBoolean("playing")) return;
                NativePlayer.exec(a, NativePlayer::stopAll);
            }
            MediaPlaybackService.State s = new MediaPlaybackService.State();
            s.playing = o.optBoolean("playing"); s.hasPlayer = o.optBoolean("hasPlayer", true); s.buffering = o.optBoolean("buffering");
            s.title = AppNotifier.clip(o.optString("title", ""), 200); s.artist = AppNotifier.clip(o.optString("artist", ""), 200);
            s.album = AppNotifier.clip(o.optString("album", ""), 200);
            s.durationMs = Math.max(0, o.optLong("duration")); s.positionMs = Math.max(0, o.optLong("position"));
            String key = o.optString("coverKey", ""), data = o.optString("cover", "");
            if (!data.isEmpty() && (!key.equals(lastCoverKey) || lastCover == null)) {
                lastCover = decodeCover(data); lastCoverKey = key;
            } else if (key.isEmpty()) { lastCover = null; lastCoverKey = ""; }
            else if (!key.equals(lastCoverKey)) { lastCover = null; lastCoverKey = key; }
            s.cover = lastCover;
            MediaPlaybackService.sync(a, s);
            Widgets.player(a, s.hasPlayer && (s.playing || !s.title.isEmpty()), s.playing, s.title, s.artist, "web");
            if (s.playing) a.ui.post(a::onMusicStarted);
        } catch (Exception ignored) {}
    }

    /** type: light | medium | heavy | success | warning | error | selection. Rate-limited, uses the system haptic setting. */
    @JavascriptInterface public void haptic(String capability, String type) { if (ok(capability)) a.haptic(type); }

    // ----- 2.9.0 -----
    /** Site theme: color '#rrggbb' (meta[name=theme-color]), light = dark system-bar icons. */
    @JavascriptInterface public void onTheme(String capability, String color, boolean light) { if (ok(capability)) a.ui.post(() -> a.setTheme(color, light)); }

    /** JSON {title?, text?, url?} -> system share sheet (text/plain). */
    @JavascriptInterface public boolean share(String capability, String json) {
        if (!ok(capability)) return false;
        try {
            final JSONObject o = new JSONObject(json);
            final String text = o.optString("text", ""), url = o.optString("url", ""), title = o.optString("title", "");
            if (text.isEmpty() && url.isEmpty()) return false;
            a.ui.post(() -> a.shareText(title, text, url));
            return true;
        } catch (Exception e) { return false; }
    }

    @JavascriptInterface public void copy(String capability, String text) { if (ok(capability) && text != null && text.length() <= 200000) a.ui.post(() -> a.copyText(text)); }

    /** Unread counter shown by the launcher through a silent notification (0 clears it). Returns false if notifications are not allowed. */
    @JavascriptInterface public boolean badge(String capability, int n) { return ok(capability) && AppNotifier.badge(a, n); }

    /** Last 50 console.error entries of the page: [{t, msg, src, line}] */
    @JavascriptInterface public String debugLog(String capability) { return ok(capability) ? MainActivity.consoleLogJson() : "[]"; }

    @JavascriptInterface public String webViewVersion(String capability) { return ok(capability) ? a.wvVersion : ""; }

    /** 2.9.2: true on tablets (shorter display side >= 600 dp). The user agent carries the token "VvvionTablet" too. */
    @JavascriptInterface public boolean isTablet(String capability) { return ok(capability) && a.isTablet(); }

    /** 2.9.2: {tablet, smallestWidthDp, widthDp, heightDp, landscape} */
    @JavascriptInterface public String screen(String capability) { return ok(capability) ? a.screenJson() : "{}"; }

    @JavascriptInterface public String keyboard(String capability) { return ok(capability) ? a.keyboardJson() : "{}"; }

    /** {version, versionCode, sdk, device, webView, webViewMajor, webViewPackage} */
    @JavascriptInterface public String info(String capability) {
        if (!ok(capability)) return "{}";
        try {
            int code = 0; String name = "";
            try { android.content.pm.PackageInfo pi = a.getPackageManager().getPackageInfo(a.getPackageName(), 0); name = pi.versionName; code = (int) (Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode); } catch (Exception ignored) {}
            return new JSONObject().put("version", name).put("versionCode", code).put("sdk", Build.VERSION.SDK_INT)
                .put("device", Build.MANUFACTURER + " " + Build.MODEL).put("webView", a.wvVersion).put("webViewMajor", a.wvMajor)
                .put("webViewPackage", a.wvPackage).put("tablet", a.isTablet()).toString();
        } catch (Exception e) { return "{}"; }
    }

    // ----- 3.0.0: native player (Media3) and external links -----
    /** JSON {url|src, title?, artist?, album?, artwork? (https URL or data: URL), id?, positionMs?, autoplay? (default true), repeat?, shuffle?}. false = cannot be played natively (blob:, data:, http:, bad JSON): use <audio>. */
    @JavascriptInterface public boolean plTrack(String capability, String json) {
        if (!ok(capability) || json == null || json.length() > 8_000_000) return false;
        try {
            JSONObject o = new JSONObject(json);
            androidx.media3.common.MediaItem it = NativePlayer.item(o, true);
            if (it == null) return false;
            startNative(java.util.Collections.singletonList(it), 0, o);
            return true;
        } catch (Throwable e) { return false; }
    }

    /** JSON {items:[{url,title,artist,album,artwork,id}], startIndex?, positionMs?, autoplay?, repeat?, shuffle?}. All items must be playable natively, otherwise false. Only the start item keeps a data: artwork. */
    @JavascriptInterface public boolean plQueue(String capability, String json) {
        if (!ok(capability) || json == null || json.length() > 8_000_000) return false;
        try {
            JSONObject o = new JSONObject(json);
            JSONArray arr = o.optJSONArray("items");
            if (arr == null || arr.length() == 0 || arr.length() > NativePlayer.MAX_ITEMS) return false;
            int start = Math.max(0, Math.min(o.optInt("startIndex", 0), arr.length() - 1));
            java.util.List<androidx.media3.common.MediaItem> items = new java.util.ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject io = arr.optJSONObject(i);
                androidx.media3.common.MediaItem it = io == null ? null : NativePlayer.item(io, i == start);
                if (it == null) return false;
                items.add(it);
            }
            startNative(items, start, o);
            return true;
        } catch (Throwable e) { return false; }
    }

    private void startNative(java.util.List<androidx.media3.common.MediaItem> items, int start, JSONObject o) {
        final long pos = Math.max(0, o.optLong("positionMs", 0));
        final boolean auto = o.optBoolean("autoplay", true);
        final String repeat = o.has("repeat") ? o.optString("repeat", "off") : null;
        final Boolean shuffle = o.has("shuffle") ? o.optBoolean("shuffle") : null;
        a.ui.post(() -> MediaPlaybackService.stop(a));          // the old WebView-audio service must not show a second notification
        NativePlayer.exec(a, c -> NativePlayer.playQueue(c, items, start, pos, auto, repeat, shuffle));
    }

    @JavascriptInterface public void plPlay(String capability) { if (ok(capability)) NativePlayer.exec(a, c -> { if (c.getPlaybackState() == androidx.media3.common.Player.STATE_ENDED) c.seekToDefaultPosition(0); if (c.getPlaybackState() == androidx.media3.common.Player.STATE_IDLE && c.getMediaItemCount() > 0) c.prepare(); c.play(); }); }
    @JavascriptInterface public void plPause(String capability) { if (ok(capability)) NativePlayer.exec(a, c -> c.pause()); }
    @JavascriptInterface public void plNext(String capability) { if (ok(capability)) NativePlayer.exec(a, c -> c.seekToNextMediaItem()); }
    @JavascriptInterface public void plPrev(String capability) { if (ok(capability)) NativePlayer.exec(a, c -> c.seekToPrevious()); }
    @JavascriptInterface public void plSeek(String capability, double ms) { if (ok(capability) && ms >= 0 && ms < 1e10) NativePlayer.exec(a, c -> c.seekTo((long) ms)); }
    @JavascriptInterface public void plStop(String capability) { if (ok(capability)) NativePlayer.stopIfAny(a); }
    @JavascriptInterface public void plRepeat(String capability, String mode) { if (ok(capability)) NativePlayer.exec(a, c -> c.setRepeatMode(NativePlayer.repeatOf(mode))); }
    @JavascriptInterface public void plShuffle(String capability, boolean on) { if (ok(capability)) NativePlayer.exec(a, c -> c.setShuffleModeEnabled(on)); }
    /** JSON {index? (default: current), title?, artist?, album?, artwork?}: late tags / cover for an item that is already queued (playback is not interrupted). */
    @JavascriptInterface public void plMeta(String capability, String json) {
        if (!ok(capability) || json == null || json.length() > 8_000_000 || !NativePlayer.active()) return;
        try { final JSONObject o = new JSONObject(json); final int idx = o.optInt("index", -1); NativePlayer.exec(a, c -> NativePlayer.updateMeta(c, idx, o)); } catch (Throwable ignored) {}
    }
    /** 3.0.0-beta3: the page tells the weather widget which city to show (the user's first saved city). Same validation as the site's cleanCity(). */
    @JavascriptInterface public void setWidgetCity(String capability, String city) { if (ok(capability) && city != null && city.length() <= 200) Widgets.setCity(a, city); }

    @JavascriptInterface public String plState(String capability) { return ok(capability) ? NativePlayer.stateJson() : "{}"; }

    /** http(s), tg:, mailto:, tel: only. Opens in another app / the browser (t.me and tg: prefer the Telegram app). Waits for the result (max 1.5 s). */
    @JavascriptInterface public boolean openExternal(String capability, String url) {
        if (!ok(capability) || url == null || url.length() > 4096) return false;
        final Uri u = Uri.parse(url.trim());
        String sc = u.getScheme() == null ? "" : u.getScheme().toLowerCase(java.util.Locale.ROOT);
        if (!(sc.equals("https") || sc.equals("http") || sc.equals("tg") || sc.equals("mailto") || sc.equals("tel"))) return false;
        final java.util.concurrent.FutureTask<Boolean> f = new java.util.concurrent.FutureTask<>(() -> a.openExternal(u));
        a.ui.post(f);
        try { return f.get(1500, java.util.concurrent.TimeUnit.MILLISECONDS); } catch (Throwable e) { return true; }
    }

    // ----- saving blob:/data: files (called by the injected script, in chunks) -----
    @JavascriptInterface public String dlBegin(String capability, String name, String mime, double size) { return ok(capability) ? a.downloads.begin(name, mime, (long) size) : ""; }
    @JavascriptInterface public boolean dlChunk(String capability, String id, String base64) { return ok(capability) && a.downloads.chunk(id, base64); }
    @JavascriptInterface public void dlEnd(String capability, String id) { if (ok(capability)) a.downloads.end(id); }
    @JavascriptInterface public void dlFail(String capability, String id) { if (ok(capability)) a.downloads.fail(id); }

    private static Bitmap decodeCover(String dataUrl) {
        try {
            int i = dataUrl.indexOf(',');
            byte[] b = Base64.decode(i >= 0 ? dataUrl.substring(i + 1) : dataUrl, Base64.DEFAULT);
            if (b.length > 2_000_000) return null;
            return BitmapFactory.decodeByteArray(b, 0, b.length);
        } catch (Exception e) { return null; }
    }
}
