package space.vvvion.app;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Player;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import java.util.Collections;

/**
 * 3.0.0: native music player (Media3). ExoPlayer + MediaSession live in this foreground service (type mediaPlayback), so the music keeps
 * playing with the screen off and after the app is swiped away from recents. Media3 owns the notification, lock screen controls,
 * headset / Bluetooth buttons and audio focus. The page drives it through VvvionApp.playTrack() & co. (see Bridge / NativePlayer).
 * Audio requests to vvvion.space /api/* carry the WebView session cookie (read from CookieManager at request time, never stored).
 */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public class NativePlayerService extends MediaSessionService {
    static final int NOTIF_ID = 1002;          // the legacy web-audio service keeps 1001
    static final long IDLE_STOP_MS = 10 * 60_000;

    static volatile NativePlayerService inst;

    private ExoPlayer player;
    private MediaSession session;
    private final Handler h = new Handler(Looper.getMainLooper());
    private final Runnable idleStop = this::shutdown;

    @Override public void onCreate() {
        super.onCreate();
        inst = this;
        AppNotifier.ensureChannels(this);
        String ua;
        try { ua = WebSettings.getDefaultUserAgent(this); } catch (Throwable t) { ua = "Mozilla/5.0 (Linux; Android) VVVionSpace"; }
        okhttp3.OkHttpClient client = new okhttp3.OkHttpClient.Builder()
            .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(25, java.util.concurrent.TimeUnit.SECONDS)
            .followSslRedirects(false)
            .addNetworkInterceptor(chain -> {
                okhttp3.Request request = chain.request();
                if (!request.url().isHttps()) throw new java.io.IOException("HTTPS media required");
                okhttp3.Request.Builder clean = request.newBuilder().removeHeader("Cookie").removeHeader("Authorization");
                // This interceptor runs again for every redirect, so private cookies cannot escape to a CDN.
                if (NativeUrlPolicy.isTrusted(request.url().toString()) && request.url().encodedPath().startsWith("/api/")) {
                    String cookie = CookieManager.getInstance().getCookie(MainActivity.HOME);
                    if (cookie != null && !cookie.isEmpty()) clean.header("Cookie", cookie);
                }
                return chain.proceed(clean.build());
            }).build();
        DataSource.Factory df = new androidx.media3.datasource.okhttp.OkHttpDataSource.Factory(client)
            .setUserAgent(ua + " vvvionApp/3.0.2");
        player = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(this).setDataSourceFactory(df))
            .setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build();
        player.addListener(new Player.Listener() {
            @Override public void onIsPlayingChanged(boolean playing) { rearm(); }
            @Override public void onPlayWhenReadyChanged(boolean pwr, int reason) { rearm(); }
        });
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        session = new MediaSession.Builder(this, player).setSessionActivity(pi).setId("vvvion-native").build();
        DefaultMediaNotificationProvider np = new DefaultMediaNotificationProvider.Builder(this)
            .setNotificationIdProvider(s -> NOTIF_ID).setChannelId(AppNotifier.CH_PLAYER).setChannelName(R.string.ch_player).build();
        np.setSmallIcon(R.drawable.ic_stat_music);
        setMediaNotificationProvider(np);
    }

    /** Paused for a long time (or finished): give the notification and the service back. */
    private void rearm() {
        h.removeCallbacks(idleStop);
        Player p = player;
        if (p != null && (!p.getPlayWhenReady() || p.getPlaybackState() == Player.STATE_ENDED)) h.postDelayed(idleStop, IDLE_STOP_MS);
    }

    @Nullable @Override public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) { return session; }

    /** Swipe from recents: keep playing if music is playing, otherwise leave. */
    @Override public void onTaskRemoved(@Nullable Intent rootIntent) {
        Player p = player;
        if (p == null || !p.getPlayWhenReady() || p.getMediaItemCount() == 0 || p.getPlaybackState() == Player.STATE_ENDED || p.getPlaybackState() == Player.STATE_IDLE) shutdown();
    }

    void shutdown() {
        h.removeCallbacks(idleStop);
        try { if (player != null) { player.stop(); player.clearMediaItems(); } } catch (Throwable ignored) {}
        try { pauseAllPlayersAndStopSelf(); } catch (Throwable t) { stopSelf(); }
    }

    @Override public void onDestroy() {
        h.removeCallbacksAndMessages(null);
        inst = null;
        if (session != null) { session.release(); session = null; }
        if (player != null) { player.release(); player = null; }
        super.onDestroy();
        NativePlayer.onServiceGone();
    }
}
