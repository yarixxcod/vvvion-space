package space.vvvion.app;

import android.content.Context;
import android.content.SharedPreferences;

/** Holds the FCM token (only ever set in builds that include Firebase) and tells the page about it. */
final class PushStore {
    private PushStore() {}
    static boolean available() {
        try { Class.forName("space.vvvion.app.FcmInit"); return true; } catch (Throwable t) { return false; }
    }
    static String token(Context c) { return c.getSharedPreferences("push", Context.MODE_PRIVATE).getString("token", ""); }
    static void setToken(Context c, String t) {
        if (t == null) return;
        c.getSharedPreferences("push", Context.MODE_PRIVATE).edit().putString("token", t).apply();
        MainActivity.emitToPage("vvvion-app-push-token", "{token:" + org.json.JSONObject.quote(t) + "}");
    }
    /** Called from MainActivity.onCreate; no-op in builds without Firebase. */
    static void init(Context c) {
        try { Class.forName("space.vvvion.app.FcmInit").getMethod("init", Context.class).invoke(null, c.getApplicationContext()); }
        catch (Throwable ignored) {}
    }
}
