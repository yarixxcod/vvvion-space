package space.vvvion.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.Icon;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;

/**
 * Foreground service (type mediaPlayback) that exists only while the site's player is playing (or just paused).
 * It owns the MediaSession + media notification (lock screen / shade / headset buttons) and keeps the process alive and
 * the CPU/Wi-Fi awake so the WebView keeps streaming with the screen off. The audio itself is still played by the WebView.
 * No self-install, no alarms, no battery-optimisation exemption, no polling.
 */
public class MediaPlaybackService extends Service {
    static final class State {
        boolean playing, hasPlayer = true, buffering;
        String title = "", artist = "", album = "";
        long durationMs, positionMs;
        Bitmap cover;
        long at = SystemClock.elapsedRealtime();
    }

    static final String ACT_UPDATE = "space.vvvion.app.MEDIA_UPDATE", ACT_PLAY = "space.vvvion.app.MEDIA_PLAY",
        ACT_PAUSE = "space.vvvion.app.MEDIA_PAUSE", ACT_NEXT = "space.vvvion.app.MEDIA_NEXT",
        ACT_PREV = "space.vvvion.app.MEDIA_PREV", ACT_STOP = "space.vvvion.app.MEDIA_STOP";
    static final int NOTIF_ID = 1001;
    static final long DETACH_AFTER_PAUSE_MS = 15_000, STOP_AFTER_PAUSE_MS = 5 * 60_000, STOP_IF_NO_PLAYER_MS = 20_000;

    static volatile MediaPlaybackService inst;
    static volatile State state = new State();

    /** Called from the bridge thread. Starts the service when playback starts; updates it while it runs. */
    static void sync(Context c, State s) {
        s.at = SystemClock.elapsedRealtime();
        state = s;
        MediaPlaybackService running = inst;
        if (running != null) { running.h.post(running::refresh); return; }   // no intent needed: works even when the app is in background
        if (!s.playing) return;                                              // nothing to show and nothing running
        Context app = c.getApplicationContext();
        Intent i = new Intent(app, MediaPlaybackService.class).setAction(ACT_UPDATE);
        try {
            if (Build.VERSION.SDK_INT >= 26) app.startForegroundService(i); else app.startService(i);
        } catch (Exception e) { /* FGS start not allowed right now: skip, playback itself is unaffected */ }
    }

    static boolean active() { return inst != null; }

    static void stop(Context c) {
        MediaPlaybackService s = inst;
        if (s != null) s.shutdown();
    }

    private final Handler h = new Handler(Looper.getMainLooper());
    private MediaSession session;
    private NotificationManager nm;
    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;
    private boolean foreground = false, createdNotif = false;
    private final Runnable detachR = this::detach, stopR = this::shutdown;
    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(i.getAction()) && state.playing) MainActivity.mediaCmd("pause", 0);
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        inst = this;
        nm = getSystemService(NotificationManager.class);
        AppNotifier.ensureChannels(this);
        session = new MediaSession(this, "VVVion Space");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { MainActivity.mediaCmd("play", 0); }
            @Override public void onPause() { MainActivity.mediaCmd("pause", 0); }
            @Override public void onSkipToNext() { MainActivity.mediaCmd("next", 0); }
            @Override public void onSkipToPrevious() { MainActivity.mediaCmd("prev", 0); }
            @Override public void onSeekTo(long pos) { MainActivity.mediaCmd("seek", pos); }
            @Override public void onStop() { MainActivity.mediaCmd("pause", 0); h.post(MediaPlaybackService.this::shutdown); }
        });
        session.setActive(true);
        IntentFilter f = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisy, f, Context.RECEIVER_NOT_EXPORTED); else registerReceiver(noisy, f);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null ? ACT_UPDATE : intent.getAction();
        if (a == null) a = ACT_UPDATE;
        if (!MainActivity.hasWeb()) {                     // the WebView is gone (activity destroyed): nothing to control
            if (!foreground) { try { startForeground(NOTIF_ID, build(state)); } catch (Exception ignored) {} }
            shutdown(); return START_NOT_STICKY;
        }
        switch (a) {
            case ACT_PLAY: MainActivity.mediaCmd("play", 0); break;
            case ACT_PAUSE: MainActivity.mediaCmd("pause", 0); break;
            case ACT_NEXT: MainActivity.mediaCmd("next", 0); break;
            case ACT_PREV: MainActivity.mediaCmd("prev", 0); break;
            case ACT_STOP: MainActivity.mediaCmd("pause", 0); shutdown(); return START_NOT_STICKY;
            default: break;
        }
        refresh();
        return START_NOT_STICKY;
    }

    private void refresh() {
        State s = state;
        updateSession(s);
        Notification n = build(s);
        h.removeCallbacks(detachR); h.removeCallbacks(stopR);
        if (s.playing) {
            acquireLocks();
            try {
                if (!foreground || !createdNotif) startFg(n); else nm.notify(NOTIF_ID, n);
            } catch (Exception e) { try { nm.notify(NOTIF_ID, n); } catch (Exception ignored) {} }
        } else {
            releaseLocks();
            try {
                if (foreground) nm.notify(NOTIF_ID, n);
                else if (!createdNotif) startFg(n);
                else nm.notify(NOTIF_ID, n);
            } catch (Exception e) { try { nm.notify(NOTIF_ID, n); } catch (Exception ignored) {} }
            // track changes show as a short "paused": stay foreground a little, then become a normal swipeable notification
            h.postDelayed(detachR, DETACH_AFTER_PAUSE_MS);
            h.postDelayed(stopR, s.hasPlayer ? STOP_AFTER_PAUSE_MS : STOP_IF_NO_PLAYER_MS);
        }
        MainActivity.onMediaServiceState();
    }

    private void startFg(Notification n) {
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTIF_ID, n);
        foreground = true; createdNotif = true;
    }

    private void detach() {
        if (state.playing) return;
        if (foreground) {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(Service.STOP_FOREGROUND_DETACH); else stopForeground(false);
            foreground = false;
        }
        try { nm.notify(NOTIF_ID, build(state)); } catch (Exception ignored) {}   // ongoing=false now -> user can swipe it away
    }

    void shutdown() {
        h.removeCallbacks(detachR); h.removeCallbacks(stopR);
        releaseLocks();
        try { stopForeground(Service.STOP_FOREGROUND_REMOVE); } catch (Exception ignored) {}
        try { nm.cancel(NOTIF_ID); } catch (Exception ignored) {}
        foreground = false;
        stopSelf();
    }

    @Override public void onTaskRemoved(Intent rootIntent) { shutdown(); super.onTaskRemoved(rootIntent); }

    @Override public void onDestroy() {
        inst = null;
        h.removeCallbacksAndMessages(null);
        releaseLocks();
        try { unregisterReceiver(noisy); } catch (Exception ignored) {}
        if (session != null) { session.setActive(false); session.release(); session = null; }
        MainActivity.onMediaServiceState();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    // ---------- session / notification ----------
    private void updateSession(State s) {
        if (session == null) return;
        MediaMetadata.Builder m = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, s.title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, s.artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, s.album)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, s.durationMs > 0 ? s.durationMs : -1);
        if (s.cover != null) m.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, s.cover);
        session.setMetadata(m.build());
        int st = s.playing ? (s.buffering ? PlaybackState.STATE_BUFFERING : PlaybackState.STATE_PLAYING) : PlaybackState.STATE_PAUSED;
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
            | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP
            | (s.durationMs > 0 ? PlaybackState.ACTION_SEEK_TO : 0);
        session.setPlaybackState(new PlaybackState.Builder().setActions(actions)
            .setState(st, s.positionMs, s.playing ? 1f : 0f, SystemClock.elapsedRealtime()).build());
    }

    private PendingIntent act(String action, int code) {
        Intent i = new Intent(this, MediaPlaybackService.class).setAction(action);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification.Action action(int icon, int title, PendingIntent pi) {
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), getString(title), pi).build();
    }

    private Notification build(State s) {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, AppNotifier.CH_PLAYER) : new Notification.Builder(this);
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        b.setSmallIcon(R.drawable.ic_stat_music).setColor(Color.parseColor("#c4b5e8"))
            .setContentTitle(s.title.isEmpty() ? "VVVion Space" : s.title)
            .setContentText(s.artist.isEmpty() ? "VVVion Space" : s.artist)
            .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
            .setDeleteIntent(act(ACT_STOP, 5))
            .setVisibility(Notification.VISIBILITY_PUBLIC).setCategory(Notification.CATEGORY_TRANSPORT)
            .setOnlyAlertOnce(true).setShowWhen(false).setOngoing(s.playing || foreground);
        if (s.cover != null) b.setLargeIcon(s.cover);
        b.addAction(action(R.drawable.ic_media_prev, R.string.act_prev, act(ACT_PREV, 1)));
        if (s.playing) b.addAction(action(R.drawable.ic_media_pause, R.string.act_pause, act(ACT_PAUSE, 2)));
        else b.addAction(action(R.drawable.ic_media_play, R.string.act_play, act(ACT_PLAY, 3)));
        b.addAction(action(R.drawable.ic_media_next, R.string.act_next, act(ACT_NEXT, 4)));
        Notification.MediaStyle st = new Notification.MediaStyle().setShowActionsInCompactView(0, 1, 2);
        if (session != null) st.setMediaSession(session.getSessionToken());
        b.setStyle(st);
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    // ---------- locks (only while actually playing) ----------
    @SuppressWarnings("deprecation")
    private void acquireLocks() {
        try {
            if (wake == null) {
                PowerManager pm = getSystemService(PowerManager.class);
                wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "vvvion:media"); wake.setReferenceCounted(false);
            }
            if (!wake.isHeld()) wake.acquire(6 * 60 * 60_000L);
            if (wifi == null) {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) { wifi = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "vvvion:media"); wifi.setReferenceCounted(false); }
            }
            if (wifi != null && !wifi.isHeld()) wifi.acquire();
        } catch (Exception ignored) {}
    }

    private void releaseLocks() {
        try { if (wake != null && wake.isHeld()) wake.release(); } catch (Exception ignored) {}
        try { if (wifi != null && wifi.isHeld()) wifi.release(); } catch (Exception ignored) {}
    }
}
