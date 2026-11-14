package space.vvvion.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.webkit.CookieManager;
import android.widget.RemoteViews;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONObject;

/**
 * 3.0.0-beta3: home-screen widgets (weather, KZT rates, wuble balance, now playing). No new permissions, no new libraries.
 * Network widgets are refreshed by the system (updatePeriodMillis = 30 min, the platform minimum), when the app comes to the front (throttled)
 * and when the user adds the widget. Every fetch runs on a worker thread with short timeouts; on failure the last cached value stays on screen
 * with a "нет сети" note. Cached values live in the app-private SharedPreferences "widgets". Cookies are only read from CookieManager,
 * only sent to https://vvvion.space, and never logged or stored.
 */
final class Widgets {
    private Widgets() {}

    static final String PREFS = "widgets";
    static final String ACT_PLAY = "space.vvvion.app.W_PLAY", ACT_PREV = "space.vvvion.app.W_PREV", ACT_NEXT = "space.vvvion.app.W_NEXT";
    static final String SITE = "https://vvvion.space";
    /** Expected site endpoint (see CLAUDE-WIDGETS-RU.md): GET -> 200 {"balance": <number>, "weatherCities": ["Алматы", ...]} (newest city first, like the site)
     *  with the better-auth session cookie; 401/403 when logged out. */
    static final String WIDGETS_URL = SITE + "/api/app/widgets";
    static final String DEFAULT_CITY = "Алматы";
    static final long RESUME_THROTTLE_MS = 15 * 60_000;
    private static long lastResume = 0;

    private static SharedPreferences sp(Context c) { return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static int[] ids(Context c, Class<?> provider) {
        try { return AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c, provider)); } catch (Throwable t) { return new int[0]; }
    }
    private static boolean any(Context c, Class<?> p) { return ids(c, p).length > 0; }

    private static PendingIntent openApp(Context c, int code) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
    private static PendingIntent action(Context c, String act, int code) {
        Intent i = new Intent(c, WidgetActions.class).setAction(act);
        return PendingIntent.getBroadcast(c, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
    private static void push(Context c, Class<?> provider, RemoteViews rv) {
        try { AppWidgetManager.getInstance(c).updateAppWidget(new ComponentName(c, provider), rv); } catch (Throwable ignored) {}
    }
    private static String time(long ms) { return new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date(ms)); }
    private static String upd(SharedPreferences p, String k) {
        long t = p.getLong(k + "_at", 0);
        String s = t == 0 ? "ещё не обновлялось" : "обновлено " + time(t);
        return p.getBoolean(k + "_err", false) ? s + " · нет сети" : s;
    }

    // ---------------------------------------------------------------- refresh entry points
    /** Fetches and renders the three network widgets that are on a home screen. Blocking: call from a worker thread. */
    static void refreshNetwork(Context c) {
        c = c.getApplicationContext();
        if (any(c, WeatherWidget.class)) { fetchWeather(c); renderWeather(c); }
        if (any(c, RatesWidget.class)) { fetchRates(c); renderRates(c); }
        if (any(c, BalanceWidget.class)) { fetchBalance(c); renderBalance(c); }
    }

    static void refreshOnResume(Context c) {
        final Context a = c.getApplicationContext();
        long now = System.currentTimeMillis();
        if (now - lastResume < RESUME_THROTTLE_MS) return;
        if (!any(a, WeatherWidget.class) && !any(a, RatesWidget.class) && !any(a, BalanceWidget.class)) return;
        lastResume = now;
        Thread t = new Thread(() -> { try { refreshNetwork(a); } catch (Throwable ignored) {} }, "vv-widgets");
        t.setDaemon(true); t.start();
    }

    // ---------------------------------------------------------------- HTTP
    private static String get(String url, String cookie, int[] status) throws Exception { return get(url, cookie, status, "VVVionSpace-Widget/3.0 (Android)", 256 * 1024); }

    private static String get(String url, String cookie, int[] status, String ua, int cap) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(7000); c.setReadTimeout(8000);
            c.setInstanceFollowRedirects(cookie == null);   // a request that carries the session cookie never follows a redirect elsewhere
            c.setRequestProperty("User-Agent", ua);
            c.setRequestProperty("Accept", "application/json");
            if (cookie != null) c.setRequestProperty("Cookie", cookie);
            int code = c.getResponseCode();
            if (status != null) status[0] = code;
            if (code != 200) return null;
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] b = new byte[4096]; int n, total = 0;
                while ((n = in.read(b)) > 0) { total += n; if (total > cap) return null; out.write(b, 0, n); }
                return out.toString("UTF-8");
            }
        } finally { c.disconnect(); }
    }

    // ---------------------------------------------------------------- weather: same service and wording as the site (wttr.in, src/lib/weather/*)
    private static final java.util.regex.Pattern CITY_RE = java.util.regex.Pattern.compile("^[\\p{L}\\p{N}][\\p{L}\\p{N} .,'-]{1,59}$");

    /** Same rules as the site's cleanCity(). Returns null when the name would not be accepted. */
    static String cleanCity(String v) {
        if (v == null) return null;
        String c = v.replaceAll("[\\u0000-\\u001f]", " ").replaceAll("\\s+", " ").trim();
        if (c.length() > 60) c = c.substring(0, 60);
        return CITY_RE.matcher(c).matches() ? c : null;
    }

    static String city(Context c) {
        String v = sp(c).getString("w_city", null);
        return v == null || v.isEmpty() ? DEFAULT_CITY : v;
    }

    /** VvvionApp.setWidgetCity(): the page tells which city the user follows (first saved city). Cached; weather is re-fetched in the background. */
    static void setCity(Context c, String raw) {
        final Context a = c.getApplicationContext();
        final String city = cleanCity(raw);
        if (city == null) return;
        SharedPreferences p = sp(a);
        if (city.equals(p.getString("w_city", ""))) return;
        p.edit().putString("w_city", city).apply();
        if (!any(a, WeatherWidget.class)) return;
        renderWeather(a);
        Thread t = new Thread(() -> { try { fetchWeather(a, false); renderWeather(a); } catch (Throwable ignored) {} }, "vv-widget-city");
        t.setDaemon(true); t.start();
    }

    static void fetchWeather(Context c) { fetchWeather(c, true); }

    static void fetchWeather(Context c, boolean syncAccount) {
        SharedPreferences p = sp(c);
        if (syncAccount) syncAccount(c);   // learns the user's first saved city (cookie session); silently skipped when logged out / endpoint missing
        String city = city(c);
        try {
            String body = get("https://wttr.in/" + Uri.encode(city) + "?format=j1", null, null, "curl/8.7.1", 1_500_000);
            if (body == null || body.trim().startsWith("<")) throw new Exception("http");
            JSONObject root = new JSONObject(body);
            JSONObject now = root.getJSONArray("current_condition").getJSONObject(0);
            int code = codeOf(now.opt("weatherCode"));
            int temp = wnum(now.opt("temp_C"), 0);
            int feels = wnum(now.opt("FeelsLikeC"), temp);
            org.json.JSONArray w = root.optJSONArray("weather");
            JSONObject day = w != null && w.length() > 0 ? w.optJSONObject(0) : null;
            SharedPreferences.Editor e = p.edit().putString("w_for", city).putInt("x_t", temp).putInt("x_feel", feels).putInt("x_code", code)
                .putLong("weather_at", System.currentTimeMillis()).putBoolean("weather_err", false);
            if (day != null) e.putInt("x_hi", wnum(day.opt("maxtempC"), temp)).putInt("x_lo", wnum(day.opt("mintempC"), temp)).putBoolean("x_hasday", true);
            else e.putBoolean("x_hasday", false);
            e.apply();
        } catch (Throwable t) { p.edit().putBoolean("weather_err", true).apply(); }
    }

    /** parse.ts num(): Number(value), rounded, clamped to -80..60, fallback when not numeric. */
    private static int wnum(Object v, int fallback) {
        try {
            double d = v instanceof Number ? ((Number) v).doubleValue() : Double.parseDouble(String.valueOf(v).trim());
            if (Double.isNaN(d) || Double.isInfinite(d)) return fallback;
            return (int) Math.max(-80, Math.min(60, Math.round(d)));
        } catch (Throwable t) { return fallback; }
    }
    /** parse.ts codeOf(): fallback 122 (Пасмурно). */
    private static int codeOf(Object v) {
        try { double d = v instanceof Number ? ((Number) v).doubleValue() : Double.parseDouble(String.valueOf(v).trim()); return Double.isNaN(d) ? 122 : (int) Math.round(d); } catch (Throwable t) { return 122; }
    }

    private static String deg(int v) { return (v < 0 ? "−" : "") + Math.abs(v) + "°"; }

    private static final java.util.Map<Integer, String> PHRASE = new java.util.HashMap<>();
    static {
        Object[] t = {113, "Ясно", 116, "Переменная облачность", 119, "Облачно", 122, "Пасмурно", 143, "Дымка", 149, "Дымка", 176, "Местами дождь", 179, "Местами снег",
            182, "Местами мокрый снег", 185, "Ледяная морось", 200, "Гроза", 227, "Позёмок", 230, "Метель", 248, "Туман", 260, "Ледяной туман", 263, "Местами морось",
            266, "Морось", 281, "Ледяная морось", 284, "Сильная ледяная морось", 293, "Местами небольшой дождь", 296, "Небольшой дождь", 299, "Временами умеренный дождь",
            302, "Умеренный дождь", 305, "Временами сильный дождь", 308, "Сильный дождь", 311, "Небольшой ледяной дождь", 314, "Сильный ледяной дождь",
            317, "Небольшой мокрый снег", 320, "Сильный мокрый снег", 323, "Местами небольшой снег", 326, "Небольшой снег", 329, "Местами умеренный снег",
            332, "Умеренный снег", 335, "Местами сильный снег", 338, "Сильный снег", 350, "Ледяная крупа", 353, "Небольшой ливень", 356, "Ливень", 359, "Сильный ливень",
            362, "Небольшой дождь со снегом", 365, "Дождь со снегом", 368, "Небольшой снег", 371, "Сильный снегопад", 374, "Небольшая ледяная крупа", 377, "Ледяная крупа",
            386, "Местами гроза с дождём", 389, "Гроза с дождём", 392, "Местами гроза со снегом", 395, "Гроза со снегом"};
        for (int i = 0; i < t.length; i += 2) PHRASE.put((Integer) t[i], (String) t[i + 1]);
    }
    private static boolean in(int c, int... l) { for (int x : l) if (x == c) return true; return false; }

    /** parse.ts weatherKind() -> emoji for the same kinds the site draws (sun/partly/cloud/rain/snow/storm/fog). */
    private static String kindIcon(int c) {
        if (in(c, 200, 386, 389, 392, 395)) return "⛈";
        if (in(c, 179, 182, 185, 227, 230, 281, 284, 311, 314, 317, 320, 323, 326, 329, 332, 335, 338, 350, 362, 365, 368, 371, 374, 377)) return "❄️";
        if (in(c, 176, 263, 266, 293, 296, 299, 302, 305, 308, 353, 356, 359)) return "🌧";
        if (in(c, 143, 149, 248, 260)) return "🌫";
        if (c == 113) return "☀️";
        if (c == 116) return "⛅";
        return "☁️";
    }
    private static String describe(int c) { String d = PHRASE.get(c); return d == null ? "Облачно" : d; }

    static void renderWeather(Context c) {
        SharedPreferences p = sp(c);
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget_weather);
        boolean have = p.getLong("weather_at", 0) != 0;
        String shown = have ? p.getString("w_for", city(c)) : city(c);
        rv.setTextViewText(R.id.w_label, "Погода · " + shown);
        if (!have) {
            rv.setTextViewText(R.id.w_temp, "—"); rv.setTextViewText(R.id.w_cond, "Загружаем погоду…"); rv.setTextViewText(R.id.w_hilo, "");
        } else {
            int code = p.getInt("x_code", 122);
            rv.setTextViewText(R.id.w_temp, deg(p.getInt("x_t", 0)));
            rv.setTextViewText(R.id.w_cond, kindIcon(code) + " " + describe(code));
            String hl = p.getBoolean("x_hasday", false) ? "↑ " + deg(p.getInt("x_hi", 0)) + "  ↓ " + deg(p.getInt("x_lo", 0)) + "  ·  " : "";
            rv.setTextViewText(R.id.w_hilo, hl + "ощущается " + deg(p.getInt("x_feel", 0)));
        }
        rv.setTextViewText(R.id.w_upd, upd(p, "weather"));
        rv.setOnClickPendingIntent(R.id.w_root, openApp(c, 11));
        push(c, WeatherWidget.class, rv);
    }

    // ---------------------------------------------------------------- KZT rates (open.er-api.com, no key; one request, USD base)
    static void fetchRates(Context c) {
        SharedPreferences p = sp(c);
        try {
            String body = get("https://open.er-api.com/v6/latest/USD", null, null);
            if (body == null) throw new Exception("http");
            JSONObject r = new JSONObject(body).getJSONObject("rates");
            double kzt = r.getDouble("KZT"), rub = r.getDouble("RUB"), eur = r.getDouble("EUR");
            if (!(kzt > 0 && rub > 0 && eur > 0)) throw new Exception("bad");
            p.edit().putFloat("r_usd", (float) kzt).putFloat("r_eur", (float) (kzt / eur)).putFloat("r_rub", (float) (kzt / rub))
                .putLong("rates_at", System.currentTimeMillis()).putBoolean("rates_err", false).apply();
        } catch (Throwable t) { p.edit().putBoolean("rates_err", true).apply(); }
    }

    private static String num(double v, int dec) { return String.format(new Locale("ru"), "%,." + dec + "f", v).replace('\u00a0', ' '); }

    static void renderRates(Context c) {
        SharedPreferences p = sp(c);
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget_rates);
        boolean have = p.getLong("rates_at", 0) != 0;
        rv.setTextViewText(R.id.w_usd, have ? num(p.getFloat("r_usd", 0), 1) : "—");
        rv.setTextViewText(R.id.w_eur, have ? num(p.getFloat("r_eur", 0), 1) : "—");
        rv.setTextViewText(R.id.w_rub, have ? num(p.getFloat("r_rub", 0), 2) : "—");
        rv.setTextViewText(R.id.w_upd, upd(p, "rates"));
        rv.setOnClickPendingIntent(R.id.w_root, openApp(c, 12));
        push(c, RatesWidget.class, rv);
    }

    // ---------------------------------------------------------------- account data (cookie session): wuble balance + saved weather cities
    private static long lastAccount = 0;

    /** One request to GET /api/app/widgets with the app's session cookie. Throttled (20 s) so several widgets updating together share it. */
    static synchronized void syncAccount(Context c) {
        long now = System.currentTimeMillis();
        if (now - lastAccount < 20_000) return;
        lastAccount = now;
        SharedPreferences p = sp(c);
        String cookie = null;
        try { cookie = CookieManager.getInstance().getCookie(SITE); } catch (Throwable ignored) {}
        if (cookie == null || cookie.trim().isEmpty()) { p.edit().putString("b_state", "login").remove("b_val").apply(); return; }
        int[] st = {0};
        try {
            String body = get(WIDGETS_URL, cookie, st);
            if (body == null) {
                if (st[0] == 401 || st[0] == 403) p.edit().putString("b_state", "login").remove("b_val").apply();
                else if (st[0] == 404) p.edit().putString("b_state", "noapi").remove("b_val").apply();
                else p.edit().putBoolean("balance_err", true).apply();
                return;
            }
            JSONObject o = new JSONObject(body);
            SharedPreferences.Editor e = p.edit().putBoolean("balance_err", false);
            if (o.has("balance")) {
                double v = o.getDouble("balance");
                e.putString("b_state", "ok").putString("b_val", v == Math.rint(v) ? num(v, 0) : num(v, 2)).putLong("balance_at", System.currentTimeMillis());
            }
            org.json.JSONArray cs = o.optJSONArray("weatherCities");
            if (cs != null && cs.length() > 0) { String city = cleanCity(cs.optString(0, "")); if (city != null) e.putString("w_city", city); }
            e.apply();
        } catch (Throwable t) { p.edit().putBoolean("balance_err", true).apply(); }
    }

    static void fetchBalance(Context c) { syncAccount(c); }

    static void renderBalance(Context c) {
        SharedPreferences p = sp(c);
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget_balance);
        String s = p.getString("b_state", "");
        if ("login".equals(s)) {
            rv.setTextViewText(R.id.w_value, "Войдите"); rv.setTextViewText(R.id.w_sub, "в приложение"); rv.setTextViewText(R.id.w_upd, "чтобы видеть баланс");
        } else if ("noapi".equals(s)) {
            rv.setTextViewText(R.id.w_value, "Скоро"); rv.setTextViewText(R.id.w_sub, "ждём обновление сайта"); rv.setTextViewText(R.id.w_upd, "");
        } else if ("ok".equals(s) && p.getString("b_val", null) != null) {
            rv.setTextViewText(R.id.w_value, p.getString("b_val", "")); rv.setTextViewText(R.id.w_sub, "вублей на счёте"); rv.setTextViewText(R.id.w_upd, upd(p, "balance"));
        } else {
            rv.setTextViewText(R.id.w_value, "—"); rv.setTextViewText(R.id.w_sub, "загружаем баланс…"); rv.setTextViewText(R.id.w_upd, p.getBoolean("balance_err", false) ? "нет сети" : "");
        }
        rv.setOnClickPendingIntent(R.id.w_root, openApp(c, 13));
        push(c, BalanceWidget.class, rv);
    }

    // ---------------------------------------------------------------- now playing
    /** Called by NativePlayer / Bridge on every player change. Cheap: re-renders only when title/artist/playing changed and a widget exists. */
    static void player(Context c, boolean active, boolean playing, String title, String artist, String src) {
        if (c == null) return;
        c = c.getApplicationContext();
        if (!active) { title = ""; artist = ""; playing = false; src = ""; }
        SharedPreferences p = sp(c);
        title = title == null ? "" : title; artist = artist == null ? "" : artist;
        if (title.equals(p.getString("p_title", "")) && artist.equals(p.getString("p_artist", "")) && playing == p.getBoolean("p_playing", false) && src.equals(p.getString("p_src", ""))) return;
        p.edit().putString("p_title", title).putString("p_artist", artist).putBoolean("p_playing", playing).putString("p_src", src).apply();
        if (any(c, PlayerWidget.class)) renderPlayer(c);
    }

    static boolean playerPlaying(Context c) { return sp(c).getBoolean("p_playing", false); }

    static void renderPlayer(Context c) {
        SharedPreferences p = sp(c);
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget_player);
        String title = p.getString("p_title", ""), artist = p.getString("p_artist", "");
        boolean has = !title.isEmpty() || !artist.isEmpty() || !p.getString("p_src", "").isEmpty();
        boolean playing = has && p.getBoolean("p_playing", false);
        rv.setTextViewText(R.id.w_title, has ? (title.isEmpty() ? "Музыка" : title) : "Ничего не играет");
        rv.setTextViewText(R.id.w_artist, has ? artist : "Включи музыку в VVVion Space");
        rv.setImageViewResource(R.id.w_play, playing ? R.drawable.ic_w_pause : R.drawable.ic_w_play);
        rv.setContentDescription(R.id.w_play, playing ? "Пауза" : "Играть");
        rv.setContentDescription(R.id.w_prev, "Предыдущий трек");
        rv.setContentDescription(R.id.w_next, "Следующий трек");
        rv.setOnClickPendingIntent(R.id.w_prev, action(c, ACT_PREV, 21));
        rv.setOnClickPendingIntent(R.id.w_play, action(c, ACT_PLAY, 22));
        rv.setOnClickPendingIntent(R.id.w_next, action(c, ACT_NEXT, 23));
        PendingIntent open = openApp(c, 24);
        rv.setOnClickPendingIntent(R.id.w_root, open);
        rv.setOnClickPendingIntent(R.id.w_title, open);
        rv.setOnClickPendingIntent(R.id.w_artist, open);
        rv.setOnClickPendingIntent(R.id.w_label, open);
        push(c, PlayerWidget.class, rv);
    }

    /** Buttons. Native player when it owns playback, else the WebView player (only reachable while the media service keeps the page alive). */
    static void handleAction(Context c, String act) {
        c = c.getApplicationContext();
        final boolean playing = playerPlaying(c);
        if (NativePlayer.active()) {
            NativePlayer.exec(c, ctl -> {
                if (ACT_PREV.equals(act)) ctl.seekToPrevious();
                else if (ACT_NEXT.equals(act)) ctl.seekToNextMediaItem();
                else if (ctl.isPlaying() || ctl.getPlayWhenReady()) ctl.pause();
                else { if (ctl.getPlaybackState() == androidx.media3.common.Player.STATE_ENDED) ctl.seekToDefaultPosition(0); ctl.play(); }
            });
        } else if (MainActivity.hasWeb() && MediaPlaybackService.active()) {
            MainActivity.mediaCmd(ACT_PREV.equals(act) ? "prev" : ACT_NEXT.equals(act) ? "next" : playing ? "pause" : "play", 0);
        } else {
            player(c, false, false, "", "", "");   // nothing alive to control: heal a stale widget; the title area opens the app
            renderPlayer(c);
        }
    }
}
