package space.vvvion.app;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;

/**
 * App-side disk cache for static vvvion.space files (hashed /assets/*, fonts, images, icons), used from shouldInterceptRequest.
 *  - class 1: hashed build assets (immutable): cache first, never revalidated.
 *  - class 2: other static images/fonts: stale-while-revalidate (served from disk, refreshed in the background after 6 h).
 * Never cached: HTML documents, /api, /_serverFn, auth, non-GET, Range (media streams), anything with Set-Cookie,
 * Cache-Control no-store/private, text/html answers (SPA fallbacks), files above 25 MB. Total size is capped (LRU by last use).
 * Any failure returns null, which makes the WebView do the request itself.
 */
final class AssetCache {
    static final long MAX_BYTES = 100L * 1024 * 1024, MAX_FILE = 25L * 1024 * 1024, REVALIDATE_MS = 6L * 3600_000;
    private static final Pattern BUILD_EXT = Pattern.compile("\\.(js|mjs|css|woff2?|ttf|otf|png|jpe?g|gif|webp|avif|svg|ico)$");
    private static final Pattern PLAIN_EXT = Pattern.compile("\\.(woff2?|ttf|otf|png|jpe?g|gif|webp|avif|svg|ico)$");
    private static final Pattern HASHED = Pattern.compile("-[A-Za-z0-9_-]{8,}\\.[a-z0-9]+$");

    private final File dir;
    private final ExecutorService io = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "vv-cache-io"); t.setDaemon(true); t.setPriority(Thread.MIN_PRIORITY); return t;
    });
    private final AtomicLong approx = new AtomicLong();
    private final Set<String> revalidating = Collections.synchronizedSet(new HashSet<>());

    AssetCache(Context c) {
        dir = new File(c.getCacheDir(), "vvcache");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        io.execute(this::trim);
    }

    /** 0 = not cacheable, 1 = hashed immutable, 2 = static stale-while-revalidate. */
    static int classify(Uri u) {
        if (!"https".equals(u.getScheme())) return 0;
        String h = u.getHost();
        if (h == null || !(h.equals("vvvion.space") || h.endsWith(".vvvion.space"))) return 0;
        String p = u.getPath();
        if (p == null) return 0;
        String lp = p.toLowerCase(Locale.ROOT);
        if (lp.startsWith("/api/") || lp.startsWith("/_serverfn") || lp.startsWith("/auth") || lp.startsWith("/app/")) return 0;
        if (lp.startsWith("/assets/") && BUILD_EXT.matcher(lp).find() && HASHED.matcher(p).find()) return 1;
        if (u.getQuery() == null && PLAIN_EXT.matcher(lp).find()) return 2;
        return 0;
    }

    WebResourceResponse get(WebResourceRequest r) {
        try {
            if (!"GET".equals(r.getMethod())) return null;
            Map<String, String> rh = r.getRequestHeaders();
            if (rh != null && (rh.containsKey("Range") || rh.containsKey("range") || rh.containsKey("Authorization"))) return null;
            Uri u = r.getUrl();
            int cls = classify(u);
            if (cls == 0) return null;
            String url = u.toString(), key = key(url);
            File bin = new File(dir, key + ".bin"), meta = new File(dir, key + ".meta");
            Properties m = readMeta(meta);
            String origin = rh == null ? null : (rh.get("Origin") != null ? rh.get("Origin") : rh.get("origin"));
            if (m != null && bin.isFile() && bin.length() == parse(m.getProperty("len"), -1)) {
                //noinspection ResultOfMethodCallIgnored
                bin.setLastModified(System.currentTimeMillis());
                if (cls == 2 && System.currentTimeMillis() - parse(m.getProperty("stored"), 0) > REVALIDATE_MS && revalidating.add(key))
                    io.execute(() -> { try { revalidate(url, key, m, rh); } finally { revalidating.remove(key); } });
                return response(m.getProperty("mime", "application/octet-stream"), m.getProperty("charset"), new FileInputStream(bin), cls, origin, true);
            }
            return fetch(url, key, cls, rh, origin);
        } catch (Throwable t) {
            return null;
        }
    }

    // ---------- network ----------
    private HttpURLConnection open(String url, Map<String, String> rh) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10_000); c.setReadTimeout(20_000); c.setInstanceFollowRedirects(true);
        if (rh != null) for (String k : new String[]{"User-Agent", "Accept", "Accept-Language"}) {
            String v = rh.get(k); if (v == null) v = rh.get(k.toLowerCase(Locale.ROOT));
            if (v != null) c.setRequestProperty(k, v);
        }
        return c;
    }

    private static boolean storable(HttpURLConnection c, String mime, int cls) {
        String cc = c.getHeaderField("Cache-Control");
        if (cc != null) { String l = cc.toLowerCase(Locale.ROOT); if (l.contains("no-store") || l.contains("private")) return false; }
        if (c.getHeaderField("Set-Cookie") != null) return false;
        if (mime == null || mime.startsWith("text/html") || mime.startsWith("application/json") || mime.startsWith("application/xhtml")) return false;
        long len = c.getContentLengthLong();
        if (len > MAX_FILE) return false;
        return MainActivity.isTrusted(c.getURL().toString());   // after redirects
    }

    private WebResourceResponse fetch(String url, String key, int cls, Map<String, String> rh, String origin) throws IOException {
        HttpURLConnection c = open(url, rh);
        int code;
        try { code = c.getResponseCode(); } catch (IOException e) { c.disconnect(); return null; }
        if (code != 200) { c.disconnect(); return null; }
        String ct = c.getContentType();
        String mime = mimeOf(ct), charset = charsetOf(ct);
        InputStream in = c.getInputStream();
        if (!storable(c, mime, cls)) return response(mime == null ? "application/octet-stream" : mime, charset, in, 0, origin, false);
        File tmp = new File(dir, key + "." + System.nanoTime() + ".tmp");
        OutputStream out = new BufferedOutputStream(new FileOutputStream(tmp));
        Properties m = new Properties();
        m.setProperty("mime", mime); if (charset != null) m.setProperty("charset", charset);
        putIf(m, "etag", c.getHeaderField("ETag")); putIf(m, "lm", c.getHeaderField("Last-Modified"));
        return response(mime, charset, new Tee(in, out, tmp, key, m, c), cls, origin, false);
    }

    private void revalidate(String url, String key, Properties old, Map<String, String> rh) {
        HttpURLConnection c = null;
        try {
            c = open(url, rh);
            String et = old.getProperty("etag"), lm = old.getProperty("lm");
            if (et != null) c.setRequestProperty("If-None-Match", et);
            if (lm != null) c.setRequestProperty("If-Modified-Since", lm);
            int code = c.getResponseCode();
            File meta = new File(dir, key + ".meta");
            if (code == 304) { old.setProperty("stored", String.valueOf(System.currentTimeMillis())); writeMeta(meta, old); return; }
            if (code != 200) return;
            String ct = c.getContentType(), mime = mimeOf(ct);
            if (!storable(c, mime, 2)) { delete(key); return; }
            File tmp = new File(dir, key + "." + System.nanoTime() + ".tmp");
            long n = 0;
            try (InputStream in = c.getInputStream(); OutputStream out = new BufferedOutputStream(new FileOutputStream(tmp))) {
                byte[] b = new byte[16384]; int r;
                while ((r = in.read(b)) > 0) { n += r; if (n > MAX_FILE) throw new IOException("too big"); out.write(b, 0, r); }
            } catch (IOException e) { //noinspection ResultOfMethodCallIgnored
                tmp.delete(); return; }
            Properties m = new Properties();
            m.setProperty("mime", mime); if (charsetOf(ct) != null) m.setProperty("charset", charsetOf(ct));
            putIf(m, "etag", c.getHeaderField("ETag")); putIf(m, "lm", c.getHeaderField("Last-Modified"));
            commit(tmp, key, m, n);
        } catch (Throwable ignored) {
        } finally { if (c != null) c.disconnect(); }
    }

    /** Streams the body to the WebView while writing it to a temp file; commits only if the whole body was read. */
    private final class Tee extends FilterInputStream {
        final OutputStream out; final File tmp; final String key; final Properties meta; final HttpURLConnection conn;
        long n = 0; boolean done = false, bad = false;
        Tee(InputStream in, OutputStream out, File tmp, String key, Properties meta, HttpURLConnection conn) {
            super(in); this.out = out; this.tmp = tmp; this.key = key; this.meta = meta; this.conn = conn;
        }
        @Override public int read() throws IOException {
            int b; try { b = super.read(); } catch (IOException e) { fail(); throw e; }
            if (b < 0) finish(); else write(new byte[]{(byte) b}, 0, 1);
            return b;
        }
        @Override public int read(byte[] buf, int off, int len) throws IOException {
            int r; try { r = super.read(buf, off, len); } catch (IOException e) { fail(); throw e; }
            if (r < 0) finish(); else if (r > 0) write(buf, off, r);
            return r;
        }
        private void write(byte[] b, int off, int len) {
            if (bad || done) return;
            n += len;
            if (n > MAX_FILE) { fail(); return; }
            try { out.write(b, off, len); } catch (IOException e) { fail(); }
        }
        private void finish() {
            if (done || bad) return;
            done = true;
            try { out.close(); } catch (IOException e) { bad = true; }
            if (bad) { //noinspection ResultOfMethodCallIgnored
                tmp.delete(); return; }
            long expected = conn.getContentLengthLong();
            if (expected >= 0 && expected != n) { //noinspection ResultOfMethodCallIgnored
                tmp.delete(); return; }
            io.execute(() -> commit(tmp, key, meta, n));
        }
        private void fail() {
            if (bad) return;
            bad = true;
            try { out.close(); } catch (IOException ignored) {}
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
        }
        @Override public void close() throws IOException {
            if (!done && !bad) fail();
            try { super.close(); } finally { conn.disconnect(); }
        }
    }

    // ---------- storage ----------
    private void commit(File tmp, String key, Properties m, long len) {
        try {
            File bin = new File(dir, key + ".bin");
            m.setProperty("len", String.valueOf(len));
            m.setProperty("stored", String.valueOf(System.currentTimeMillis()));
            if (bin.exists()) //noinspection ResultOfMethodCallIgnored
                bin.delete();
            if (!tmp.renameTo(bin)) { //noinspection ResultOfMethodCallIgnored
                tmp.delete(); return; }
            writeMeta(new File(dir, key + ".meta"), m);
            if (approx.addAndGet(len) > MAX_BYTES) trim();
        } catch (Throwable ignored) {}
    }

    private void delete(String key) {
        //noinspection ResultOfMethodCallIgnored
        new File(dir, key + ".bin").delete();
        //noinspection ResultOfMethodCallIgnored
        new File(dir, key + ".meta").delete();
    }

    /** LRU: when above the cap, drop least recently used files down to 85 %. Also removes stale temp files. */
    private void trim() {
        try {
            File[] all = dir.listFiles();
            if (all == null) return;
            List<File> bins = new ArrayList<>(); long total = 0, now = System.currentTimeMillis();
            for (File f : all) {
                String n = f.getName();
                if (n.endsWith(".tmp")) { if (now - f.lastModified() > 10 * 60_000) //noinspection ResultOfMethodCallIgnored
                    f.delete(); }
                else if (n.endsWith(".bin")) { bins.add(f); total += f.length(); }
            }
            approx.set(total);
            if (total <= MAX_BYTES) return;
            Collections.sort(bins, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
            long target = (long) (MAX_BYTES * 0.85);
            for (File f : bins) {
                if (total <= target) break;
                long l = f.length();
                String n = f.getName();
                delete(n.substring(0, n.length() - 4));
                total -= l;
            }
            approx.set(total);
        } catch (Throwable ignored) {}
    }

    // ---------- helpers ----------
    private static WebResourceResponse response(String mime, String charset, InputStream in, int cls, String origin, boolean hit) {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", cls == 0 ? "no-store" : cls == 1 ? "public, max-age=31536000, immutable" : "public, max-age=3600");
        if (origin != null) { h.put("Access-Control-Allow-Origin", origin); h.put("Vary", "Origin"); }
        h.put("X-VV-Cache", hit ? "hit" : "miss");
        return new WebResourceResponse(mime, charset, 200, "OK", h, in);
    }

    private static String key(String url) throws Exception {
        byte[] d = MessageDigest.getInstance("SHA-1").digest(url.getBytes("UTF-8"));
        StringBuilder sb = new StringBuilder();
        for (byte b : d) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static String mimeOf(String ct) { if (ct == null) return null; int i = ct.indexOf(';'); return (i < 0 ? ct : ct.substring(0, i)).trim().toLowerCase(Locale.ROOT); }
    private static String charsetOf(String ct) {
        if (ct == null) return null;
        int i = ct.toLowerCase(Locale.ROOT).indexOf("charset=");
        if (i < 0) return null;
        String c = ct.substring(i + 8).trim(); int e = c.indexOf(';');
        return (e < 0 ? c : c.substring(0, e)).replace("\"", "").trim();
    }
    private static void putIf(Properties p, String k, String v) { if (v != null) p.setProperty(k, v); }
    private static long parse(String s, long d) { try { return Long.parseLong(s); } catch (Exception e) { return d; } }

    private static Properties readMeta(File f) {
        if (!f.isFile()) return null;
        try (InputStream in = new FileInputStream(f)) { Properties p = new Properties(); p.load(in); return p; } catch (IOException e) { return null; }
    }
    private static void writeMeta(File f, Properties p) throws IOException {
        File t = new File(f.getPath() + ".tmp");
        try (OutputStream o = new FileOutputStream(t)) { p.store(o, null); }
        if (!t.renameTo(f)) { //noinspection ResultOfMethodCallIgnored
            t.delete(); }
    }
}
