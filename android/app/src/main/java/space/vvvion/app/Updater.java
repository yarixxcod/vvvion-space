package space.vvvion.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Checks https://vvvion.space/app/version.json and, when a newer version exists,
 * offers to open the download page in the browser. The app does NOT download or
 * install APKs itself (that trips Google Play Protect / Device & Network Abuse).
 * Fails silently on any error.
 */
class Updater {
    static final String VERSION_URL = "https://vvvion.space/app/version.json";
    static final long INTERVAL = 6L * 60 * 60 * 1000;
    final Activity a;
    final Handler ui = new Handler(Looper.getMainLooper());
    boolean busy = false;

    Updater(Activity a) { this.a = a; }

    long currentCode() {
        try {
            PackageInfo p = a.getPackageManager().getPackageInfo(a.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
        } catch (Exception e) { return Long.MAX_VALUE; }
    }

    /** Called from onResume. */
    void onResume() { maybeCheck(); }

    void maybeCheck() {
        SharedPreferences sp = a.getSharedPreferences("upd", Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        if (busy || now - sp.getLong("last", 0) < INTERVAL) return;
        busy = true;
        new Thread(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(VERSION_URL + "?t=" + now).openConnection();
                c.setConnectTimeout(8000); c.setReadTimeout(8000); c.setUseCaches(false);
                c.setRequestProperty("Cache-Control", "no-cache");
                if (c.getResponseCode() != 200) { busy = false; return; }
                String body;
                try (InputStream in = c.getInputStream()) { body = read(in); }
                sp.edit().putLong("last", now).apply();
                JSONObject j = new JSONObject(body);
                long code = j.getLong("versionCode");
                String name = j.optString("versionName", String.valueOf(code));
                // changelog: `changes` (array of strings) wins, else `changelog` (string, one item per line)
                List<String> items = new ArrayList<>();
                JSONArray arr = j.optJSONArray("changes");
                if (arr != null) for (int i = 0; i < arr.length() && items.size() < 30; i++) { String t = arr.optString(i, "").trim(); if (!t.isEmpty()) items.add(t); }
                if (items.isEmpty()) for (String ln : j.optString("changelog", "").split("\\r?\\n")) {
                    String t = ln.replaceFirst("^\\s*[-•*·]+\\s*", "").trim();
                    if (!t.isEmpty() && items.size() < 30) items.add(t);
                }
                long minCode = j.optLong("minVersionCode", 0);
                boolean mandatory = j.optBoolean("force", false) || minCode > currentCode();
                // Where to send the user to get the new build. Prefer an explicit page; fall back to apkUrl, then the site.
                String page = j.optString("pageUrl", j.optString("apkUrl", "https://vvvion.space/app/"));
                Uri u = Uri.parse(page);
                if (code <= currentCode() || !NativeUrlPolicy.isTrusted(page)) { busy = false; return; }
                if (!mandatory && sp.getLong("skip", 0) == code) { busy = false; return; }   // "Не напоминать об этой версии"
                ui.post(() -> showDialog(name, code, items, page, mandatory));
            } catch (Exception e) { busy = false; }
            finally { if (c != null) c.disconnect(); }
        }).start();
    }

    void showDialog(String name, long code, List<String> items, String page, boolean mandatory) {
        if (a.isFinishing() || a.isDestroyed()) { busy = false; return; }
        if (VvDialog.showing()) { a.getSharedPreferences("upd", Context.MODE_PRIVATE).edit().putLong("last", 0).apply(); busy = false; return; }   // another dialog is up: ask again on the next resume
        String cur = "";
        try { cur = a.getPackageManager().getPackageInfo(a.getPackageName(), 0).versionName; } catch (Exception ignored) {}
        VvDialog d = new VvDialog(a)
                .title("Доступно обновление")
                .chip(name)
                .sub(cur == null || cur.isEmpty() ? null : "Сейчас установлена " + cur)
                .lines(items)
                .cancelable(!mandatory)
                .primary("Обновить", () -> open(page))
                .onDismiss(() -> busy = false);
        if (items.isEmpty()) d.message(mandatory
                ? "Эта версия обязательна. Откройте страницу загрузки, чтобы обновить VVVion Space."
                : "Откройте страницу загрузки, чтобы обновить VVVion Space.");
        if (!mandatory) {
            d.secondary("Позже", null);
            d.tertiary("Не напоминать об этой версии", () -> a.getSharedPreferences("upd", Context.MODE_PRIVATE).edit().putLong("skip", code).apply());
        }
        d.show();
    }

    void open(String page) {
        // Show the download page in the app's own WebView; its download link hands the
        // APK to the system downloader/browser, so the user installs it manually.
        try { ((MainActivity) a).web.loadUrl(page); return; } catch (Exception ignored) {}
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(page));
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            a.startActivity(i);
        } catch (Exception ignored) {}
    }

    static String read(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[8192]; int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        return b.toString("UTF-8");
    }
}
