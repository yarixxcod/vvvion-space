package space.vvvion.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.graphics.Color;

/** Notification channels + "show a notification that opens vvvion.space/<url>" (used by the JS bridge and by FCM). */
final class AppNotifier {
    static final String CH_MESSAGES = "messages", CH_AI = "ai", CH_SUBS = "subs", CH_PLAYER = "player", CH_DOWNLOADS = "downloads",
        CH_MONEY = "money", CH_SECURITY = "security", CH_SYSTEM = "system", CH_BADGE = "badge";
    private AppNotifier() {}

    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        nm.createNotificationChannel(channel(c, CH_MESSAGES, R.string.ch_messages, NotificationManager.IMPORTANCE_HIGH));
        nm.createNotificationChannel(channel(c, CH_AI, R.string.ch_ai, NotificationManager.IMPORTANCE_DEFAULT));
        nm.createNotificationChannel(channel(c, CH_SUBS, R.string.ch_subs, NotificationManager.IMPORTANCE_DEFAULT));
        NotificationChannel p = channel(c, CH_PLAYER, R.string.ch_player, NotificationManager.IMPORTANCE_LOW);
        p.setShowBadge(false);
        nm.createNotificationChannel(p);
        nm.createNotificationChannel(channel(c, CH_MONEY, R.string.ch_money, NotificationManager.IMPORTANCE_DEFAULT));
        nm.createNotificationChannel(channel(c, CH_SECURITY, R.string.ch_security, NotificationManager.IMPORTANCE_HIGH));
        nm.createNotificationChannel(channel(c, CH_SYSTEM, R.string.ch_system, NotificationManager.IMPORTANCE_LOW));
        NotificationChannel bg = channel(c, CH_BADGE, R.string.ch_badge, NotificationManager.IMPORTANCE_LOW);
        bg.setShowBadge(true); bg.setSound(null, null); bg.enableVibration(false); bg.setLockscreenVisibility(Notification.VISIBILITY_SECRET);
        nm.createNotificationChannel(bg);
        NotificationChannel d = channel(c, CH_DOWNLOADS, R.string.ch_downloads, NotificationManager.IMPORTANCE_LOW);
        d.setShowBadge(false);
        nm.createNotificationChannel(d);
    }

    @androidx.annotation.RequiresApi(26)
    private static NotificationChannel channel(Context c, String id, int name, int importance) {
        NotificationChannel ch = new NotificationChannel(id, c.getString(name), importance);
        ch.setLightColor(Color.parseColor("#c4b5e8"));
        return ch;
    }

    static String normalizeChannel(String ch) {
        if (CH_AI.equals(ch) || CH_SUBS.equals(ch) || CH_PLAYER.equals(ch) || CH_MONEY.equals(ch) || CH_SECURITY.equals(ch) || CH_SYSTEM.equals(ch)) return ch;
        return CH_MESSAGES;
    }

    static boolean canNotify(Context c) {
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        return nm != null && nm.areNotificationsEnabled();
    }

    /** @return true if the notification was posted. */
    static boolean show(Context c, String id, String channel, String title, String body, String url, boolean onlyWhenBackground) {
        if (title == null || title.trim().isEmpty()) return false;
        if (onlyWhenBackground && MainActivity.isForeground()) return false;
        if (!canNotify(c)) return false;
        ensureChannels(c);
        if (id == null || id.isEmpty()) id = String.valueOf(System.nanoTime());
        if (id.length() > 80) id = id.substring(0, 80);
        title = clip(title, 120); body = clip(body == null ? "" : body, 600);
        channel = normalizeChannel(channel);

        Uri target = MainActivity.safeUrl(url == null ? null : Uri.parse(url));
        Intent open = new Intent(Intent.ACTION_VIEW, target).setClass(c, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, id.hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, channel) : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.ic_stat_bell).setColor(Color.parseColor("#c4b5e8"))
            .setContentTitle(title).setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body))
            .setContentIntent(pi).setAutoCancel(true).setWhen(System.currentTimeMillis()).setShowWhen(true)
            .setCategory(CH_SUBS.equals(channel) ? Notification.CATEGORY_REMINDER
                : (CH_MONEY.equals(channel) || CH_SECURITY.equals(channel) || CH_SYSTEM.equals(channel)) ? Notification.CATEGORY_STATUS : Notification.CATEGORY_MESSAGE)
            .setVisibility(Notification.VISIBILITY_PRIVATE);
        if (Build.VERSION.SDK_INT < 26) b.setPriority(CH_MESSAGES.equals(channel) || CH_SECURITY.equals(channel) ? Notification.PRIORITY_HIGH : Notification.PRIORITY_DEFAULT);
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        try { nm.notify("vv:" + id, 2001, b.build()); return true; } catch (Exception e) { return false; }
    }

    private static int lastBadge = -1;

    /** Launcher badges on Android are notification-driven: one silent LOW notification carrying setNumber(n). n <= 0 removes it. */
    static boolean badge(Context c, int n) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return false;
        n = Math.max(0, Math.min(n, 999));
        if (n == 0) { nm.cancel("vv:badge", 2002); lastBadge = 0; return true; }
        if (!canNotify(c)) return false;
        if (n == lastBadge) return true;
        ensureChannels(c);
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(MainActivity.HOME)).setClass(c, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 2002, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CH_BADGE) : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.ic_stat_bell).setColor(Color.parseColor("#c4b5e8"))
            .setContentTitle(c.getString(R.string.app_name)).setContentText(c.getString(R.string.badge_text, n))
            .setNumber(n).setContentIntent(pi).setAutoCancel(true).setShowWhen(false).setOnlyAlertOnce(true).setLocalOnly(true)
            .setCategory(Notification.CATEGORY_STATUS).setVisibility(Notification.VISIBILITY_SECRET);
        if (Build.VERSION.SDK_INT >= 26) b.setBadgeIconType(Notification.BADGE_ICON_SMALL);
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_LOW);
        try { nm.notify("vv:badge", 2002, b.build()); lastBadge = n; return true; } catch (Exception e) { return false; }
    }

    static void cancel(Context c, String id) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null && id != null) nm.cancel("vv:" + id, 2001);
    }

    static String clip(String s, int n) { return s.length() <= n ? s : s.substring(0, n - 1) + "…"; }
}
