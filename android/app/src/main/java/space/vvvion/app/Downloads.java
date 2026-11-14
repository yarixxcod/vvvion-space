package space.vvvion.app;

import android.Manifest;
import android.app.DownloadManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.MimeTypeMap;
import android.webkit.URLUtil;
import android.widget.Toast;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * File downloads.
 *  - http(s) links  -> system DownloadManager (progress notification, public Downloads, cookies + User-Agent passed through).
 *  - blob:/data:    -> the injected script reads the blob and streams it to us in chunks; we write it to Downloads
 *                      (MediaStore on Android 10+, plain file + DownloadManager entry on older versions). Max 200 MB.
 */
final class Downloads {
    static final long MAX_BLOB = 200L * 1024 * 1024;
    static final int REQ_STORAGE = 4;
    private final MainActivity a;
    private Runnable afterPermission;
    private final Map<String, Sink> sinks = new HashMap<>();
    private int seq = 0;

    Downloads(MainActivity a) { this.a = a; }

    // ---------- WebView DownloadListener ----------
    void onDownloadStart(String url, String ua, String cd, String mime, long len) {
        if (url == null) return;
        String low = url.toLowerCase(Locale.ROOT);
        if (low.startsWith("blob:")) { a.runBlobSave(url, fileName(url, cd, mime), mime); return; }
        if (low.startsWith("data:")) { saveDataUrl(url, cd, mime); return; }
        if (!low.startsWith("https://")) { toast(a.getString(R.string.dl_failed)); return; }
        if (MainActivity.isTrusted(url)) {
            // Fetch with the browser cookie policy; do not forward session cookies through DownloadManager redirects.
            ensureStorage(() -> a.runBlobSave(url, fileName(url, cd, mime), mime));
        } else ensureStorage(() -> enqueue(url, ua, cd, mime));
    }

    private void enqueue(String url, String ua, String cd, String mime) {
        try {
            String name = fileName(url, cd, mime);
            String mt = mime;
            if (mt == null || mt.isEmpty() || "application/octet-stream".equals(mt)) {
                String g = mimeByName(name); if (g != null) mt = g;
            }
            DownloadManager.Request rq = new DownloadManager.Request(Uri.parse(url));
            if (mt != null && !mt.isEmpty()) rq.setMimeType(mt);
            if (ua != null && !ua.isEmpty()) rq.addRequestHeader("User-Agent", ua);
            String page = a.web != null ? a.web.getUrl() : null;
            if (page != null && MainActivity.isTrusted(url)) rq.addRequestHeader("Referer", MainActivity.HOME);
            rq.setTitle(name).setDescription("VVVion Space");
            rq.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            rq.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            DownloadManager dm = (DownloadManager) a.getSystemService(Context.DOWNLOAD_SERVICE);
            dm.enqueue(rq);
            toast(a.getString(R.string.dl_started));
        } catch (Exception e) {
            toast(a.getString(R.string.dl_failed));
        }
    }

    // ---------- storage permission (Android 9 and older only) ----------
    private void ensureStorage(Runnable go) {
        if (Build.VERSION.SDK_INT >= 29 || a.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED) { go.run(); return; }
        afterPermission = go;
        a.requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
    }

    void onPermissionResult(boolean granted) {
        Runnable r = afterPermission; afterPermission = null;
        if (granted && r != null) r.run(); else if (!granted) toast(a.getString(R.string.dl_need_storage));
    }

    // ---------- blob / data via chunks from the page ----------
    private static final class Sink {
        OutputStream out; Uri uri; File file; String name, mime; long written, expected;
    }

    /** @return an id for dlChunk/dlEnd, or "" if refused. */
    synchronized String begin(String name, String mime, long size) {
        if (size < 0 || size > MAX_BLOB || sinks.size() >= 4) { toast(a.getString(R.string.dl_too_big)); return ""; }
        if (Build.VERSION.SDK_INT < 29 && a.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            a.ui.post(() -> a.requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE));
            toast(a.getString(R.string.dl_need_storage)); return "";
        }
        String mt = (mime == null || mime.isEmpty()) ? "application/octet-stream" : mime;
        String nm = sanitize(name == null || name.isEmpty() ? "download" : name);
        if (nm.indexOf('.') < 0) { String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mt); if (ext != null) nm = nm + "." + ext; }
        Sink s = new Sink(); s.name = nm; s.mime = mt; s.expected = size;
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, nm); v.put(MediaStore.Downloads.MIME_TYPE, mt);
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS); v.put(MediaStore.Downloads.IS_PENDING, 1);
                s.uri = a.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (s.uri == null) throw new IOException("insert failed");
                s.out = new BufferedOutputStream(a.getContentResolver().openOutputStream(s.uri));
            } else {
                File d = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                //noinspection ResultOfMethodCallIgnored
                d.mkdirs();
                s.file = unique(d, nm);
                s.name = s.file.getName();
                s.out = new BufferedOutputStream(new FileOutputStream(s.file));
            }
        } catch (Exception e) { cleanup(s); toast(a.getString(R.string.dl_failed)); return ""; }
        String id = "d" + (++seq);
        sinks.put(id, s);
        return id;
    }

    synchronized boolean chunk(String id, String b64) {
        Sink s = sinks.get(id);
        if (s == null) return false;
        try {
            if (b64 == null || b64.length() > 512 * 1024) throw new IOException("chunk too big");
            byte[] b = Base64.decode(b64, Base64.DEFAULT);
            s.written += b.length;
            if (s.written > MAX_BLOB) throw new IOException("too big");
            s.out.write(b);
            return true;
        } catch (Exception e) {
            sinks.remove(id); cleanup(s);
            toast(a.getString(s.written > MAX_BLOB ? R.string.dl_too_big : R.string.dl_failed));
            return false;
        }
    }

    synchronized void end(String id) {
        Sink s = sinks.remove(id);
        if (s == null) return;
        try {
            if (s.written != s.expected) throw new IOException("incomplete download");
            s.out.flush(); s.out.close(); s.out = null;
            Uri open;
            if (s.uri != null) {
                ContentValues v = new ContentValues(); v.put(MediaStore.Downloads.IS_PENDING, 0);
                a.getContentResolver().update(s.uri, v, null, null);
                open = s.uri;
            } else {
                try {
                    DownloadManager dm = (DownloadManager) a.getSystemService(Context.DOWNLOAD_SERVICE);
                    //noinspection deprecation
                    dm.addCompletedDownload(s.name, "VVVion Space", true, s.mime, s.file.getAbsolutePath(), s.written, true);
                } catch (Exception ignored) {}
                MediaScannerConnection.scanFile(a, new String[]{s.file.getAbsolutePath()}, new String[]{s.mime}, null);
                open = null;
            }
            toast(a.getString(R.string.dl_saved, s.name));
            if (open != null) notifyDone(s, open);
        } catch (Exception e) {
            cleanup(s); toast(a.getString(R.string.dl_failed));
        }
    }

    synchronized void fail(String id) {
        Sink s = sinks.remove(id);
        if (s != null) { cleanup(s); }
        toast(a.getString(R.string.dl_failed));
    }

    synchronized void close() {
        for (Sink sink : sinks.values()) cleanup(sink);
        sinks.clear();
    }

    private void cleanup(Sink s) {
        try { if (s.out != null) s.out.close(); } catch (IOException ignored) {}
        try {
            if (s.uri != null) a.getContentResolver().delete(s.uri, null, null);
            if (s.file != null) //noinspection ResultOfMethodCallIgnored
                s.file.delete();
        } catch (Exception ignored) {}
    }

    private void notifyDone(Sink s, Uri uri) {
        try {
            if (!AppNotifier.canNotify(a)) return;
            AppNotifier.ensureChannels(a);
            Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, s.mime)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            PendingIntent pi = PendingIntent.getActivity(a, s.name.hashCode(), i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(a, AppNotifier.CH_DOWNLOADS) : new Notification.Builder(a);
            b.setSmallIcon(android.R.drawable.stat_sys_download_done).setColor(Color.parseColor("#c4b5e8"))
                .setContentTitle(s.name).setContentText("Загрузка завершена").setContentIntent(pi).setAutoCancel(true);
            a.getSystemService(NotificationManager.class).notify("dl:" + s.name, 3001, b.build());
        } catch (Exception ignored) {}
    }

    private void saveDataUrl(String url, String cd, String mime) {
        try {
            int comma = url.indexOf(',');
            if (comma < 0) throw new IOException();
            String head = url.substring(5, comma), body = url.substring(comma + 1);
            boolean b64 = head.toLowerCase(Locale.ROOT).contains(";base64");
            String mt = head.split(";")[0];
            if (mt.isEmpty()) mt = mime != null && !mime.isEmpty() ? mime : "text/plain";
            byte[] data = b64 ? Base64.decode(body, Base64.DEFAULT) : pctBytes(body);
            if (data.length > MAX_BLOB) { toast(a.getString(R.string.dl_too_big)); return; }
            String id = begin(fileName(null, cd, mt), mt, data.length);
            if (id.isEmpty()) return;
            // feed through the same sink path
            synchronized (this) {
                Sink s = sinks.get(id);
                if (s == null) return;
                try { s.out.write(data); s.written = data.length; } catch (IOException e) { fail(id); return; }
            }
            end(id);
        } catch (Exception e) { toast(a.getString(R.string.dl_failed)); }
    }

    // ---------- file names ----------
    static String fileName(String url, String cd, String mime) {
        String n = cdName(cd);
        if (n == null || n.trim().isEmpty()) {
            String g = null;
            try { g = URLUtil.guessFileName(url == null ? "" : url, null, mime); } catch (Exception ignored) {}
            if (url != null && url.startsWith("blob:")) g = null;
            n = g;
            if (n == null || n.isEmpty()) n = "download";
        }
        n = sanitize(n);
        if (n.indexOf('.') < 0 || n.endsWith(".bin") && mime != null && !"application/octet-stream".equals(mime)) {
            String ext = mime == null ? null : MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
            if (ext != null && !n.toLowerCase(Locale.ROOT).endsWith("." + ext)) n = (n.endsWith(".bin") ? n.substring(0, n.length() - 4) : n) + "." + ext;
        }
        return n;
    }

    private static final Pattern STAR = Pattern.compile("filename\\*\\s*=\\s*([^;]+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern PLAIN = Pattern.compile("filename\\s*=\\s*(\"((?:\\\\.|[^\"\\\\])*)\"|[^;]+)", Pattern.CASE_INSENSITIVE);

    /** Content-Disposition filename: RFC 5987 filename*=UTF-8''%D0%.. first, then filename="..." (fixing UTF-8 read as Latin-1). */
    static String cdName(String cd) {
        if (cd == null) return null;
        Matcher m = STAR.matcher(cd);
        if (m.find()) {
            String v = m.group(1).trim();
            int i = v.indexOf('\''), j = i < 0 ? -1 : v.indexOf('\'', i + 1);
            if (i >= 0 && j > i) {
                try {
                    Charset cs = Charset.forName(i == 0 ? "UTF-8" : v.substring(0, i).trim());
                    String r = new String(pctBytes(v.substring(j + 1)), cs);
                    if (!r.trim().isEmpty()) return r;
                } catch (Exception ignored) {}
            }
        }
        m = PLAIN.matcher(cd);
        if (m.find()) {
            String v = m.group(2) != null ? m.group(2).replaceAll("\\\\(.)", "$1") : m.group(1).trim();
            if (v.contains("%") && v.matches(".*%[0-9A-Fa-f]{2}.*")) {
                try { String d = new String(pctBytes(v), StandardCharsets.UTF_8); if (!d.contains("\uFFFD")) v = d; } catch (Exception ignored) {}
            }
            boolean latin = false, wide = false;
            for (char c : v.toCharArray()) { if (c >= 0x80 && c <= 0xFF) latin = true; else if (c > 0xFF) wide = true; }
            if (latin && !wide) {
                try {
                    CharsetDecoder dec = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT);
                    v = dec.decode(ByteBuffer.wrap(v.getBytes(StandardCharsets.ISO_8859_1))).toString();
                } catch (Exception ignored) {}
            }
            return v;
        }
        return null;
    }

    static byte[] pctBytes(String s) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '%' && i + 2 < s.length()) {
                try { o.write(Integer.parseInt(s.substring(i + 1, i + 3), 16)); i += 2; continue; } catch (NumberFormatException ignored) {}
            }
            byte[] b = String.valueOf(c).getBytes(StandardCharsets.UTF_8);
            if (Character.isHighSurrogate(c) && i + 1 < s.length()) { b = s.substring(i, i + 2).getBytes(StandardCharsets.UTF_8); i++; }
            o.write(b, 0, b.length);
        }
        return o.toByteArray();
    }

    static String sanitize(String n) {
        n = n.replace('\\', '/');
        int sl = n.lastIndexOf('/'); if (sl >= 0) n = n.substring(sl + 1);
        n = n.replaceAll("[\\p{Cntrl}:*?\"<>|]", "_").trim();
        while (n.startsWith(".")) n = n.substring(1);
        if (n.length() > 150) {
            int dot = n.lastIndexOf('.');
            String ext = dot > 0 && n.length() - dot <= 12 ? n.substring(dot) : "";
            n = n.substring(0, 150 - ext.length()) + ext;
        }
        return n.isEmpty() ? "download" : n;
    }

    private static String mimeByName(String name) {
        int d = name.lastIndexOf('.');
        return d < 0 ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substring(d + 1).toLowerCase(Locale.ROOT));
    }

    private static File unique(File dir, String name) {
        File f = new File(dir, name);
        if (!f.exists()) return f;
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name, ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 1; i < 1000; i++) { f = new File(dir, base + " (" + i + ")" + ext); if (!f.exists()) return f; }
        return new File(dir, base + "-" + System.currentTimeMillis() + ext);
    }

    private void toast(String msg) { a.ui.post(() -> Toast.makeText(a, msg, Toast.LENGTH_SHORT).show()); }
}
