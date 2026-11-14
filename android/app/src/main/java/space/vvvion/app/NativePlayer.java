package space.vvvion.app;

import android.content.ComponentName;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 3.0.0: the page-facing side of the native player. Everything here runs on the main thread (Bridge posts to it); the ExoPlayer itself
 * lives in NativePlayerService and is reached through a MediaController. getState() is answered from a volatile snapshot, so the JS
 * thread never blocks. State changes are pushed to the page as window event 'vvvion-app-player' (detail = {event, ...state}).
 */
final class NativePlayer {
    private NativePlayer() {}

    interface Op { void run(MediaController c); }

    static final String EVENT = "vvvion-app-player";
    static final int MAX_ITEMS = 300, ART_PX = 320;
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static Context app;
    private static MediaController ctl;
    private static ListenableFuture<MediaController> fut;
    private static final List<Op> pending = new ArrayList<>();
    private static boolean ticking = false;

    /** Immutable view read by getState() from any thread. */
    private static final class Snap {
        boolean active, playing, playWhenReady, buffering; String state = "idle";
        int index = -1, count = 0, repeat = 0; boolean shuffle;
        String id = "", url = "", title = "", artist = "", album = "";
        long pos, dur, buffered, at = SystemClock.elapsedRealtime();
    }
    private static volatile Snap snap = new Snap();
    private static volatile boolean live = false;      // there is a loaded queue (or a start request in flight)

    /** True while the native player owns playback (loaded queue or start in flight). Used to keep the old WebView-audio path quiet. */
    static boolean active() { return live; }

    // ---------------- entry points (any thread) ----------------
    static void exec(Context c, Op op) {
        final Context a = c.getApplicationContext();
        main.post(() -> run(a, op));
    }

    private static void run(Context a, Op op) {
        app = a;
        if (ctl != null && ctl.isConnected()) { op.run(ctl); return; }
        pending.add(op);
        if (fut != null) return;
        try {
            SessionToken token = new SessionToken(a, new ComponentName(a, NativePlayerService.class));
            fut = new MediaController.Builder(a, token).setApplicationLooper(Looper.getMainLooper())
                .setListener(new MediaController.Listener() {
                    @Override public void onDisconnected(MediaController controller) { gone(); }
                }).buildAsync();
            final ListenableFuture<MediaController> mine = fut;
            fut.addListener(() -> {
                try {
                    MediaController c = mine.get();
                    if (fut != mine) { c.release(); return; }
                    ctl = c; c.addListener(new L());
                    List<Op> todo = new ArrayList<>(pending); pending.clear();
                    for (Op o : todo) { try { o.run(c); } catch (Throwable t) { error("op", t.toString()); } }
                    refresh("ready");
                } catch (Throwable t) {
                    fut = null; pending.clear(); live = false; error("connect", String.valueOf(t));
                }
            }, ContextCompat.getMainExecutor(a));
        } catch (Throwable t) { fut = null; pending.clear(); live = false; error("connect", String.valueOf(t)); }
    }

    static String stateJson() { return json(snap, "state").toString(); }

    // ---------------- commands (main thread, via exec) ----------------
    static void playQueue(MediaController c, List<MediaItem> items, int start, long posMs, boolean autoplay, String repeat, Boolean shuffle) {
        live = true;
        if (repeat != null) c.setRepeatMode(repeatOf(repeat));
        if (shuffle != null) c.setShuffleModeEnabled(shuffle);
        c.setMediaItems(items, Math.max(0, Math.min(start, items.size() - 1)), Math.max(0, posMs));
        c.prepare();
        c.setPlayWhenReady(autoplay);
        refresh("queue");
    }

    /** stop() from the page: does nothing (and binds nothing) when the native player was never started. */
    static void stopIfAny(Context c) {
        final Context a = c.getApplicationContext();
        main.post(() -> { if (ctl != null || fut != null || live) run(a, NativePlayer::stopAll); });
    }

    static void stopAll(MediaController c) {
        try { c.stop(); c.clearMediaItems(); } catch (Throwable ignored) {}
        live = false;
        NativePlayerService s = NativePlayerService.inst;
        if (s != null) s.shutdown();
        MediaController old = ctl; ctl = null; fut = null; pending.clear();
        if (old != null) { try { old.release(); } catch (Throwable ignored) {} }
        snap = new Snap();
        Widgets.player(app, false, false, "", "", "");
        emit("stop");
    }

    static void updateMeta(MediaController c, int index, JSONObject o) {
        int i = index < 0 ? c.getCurrentMediaItemIndex() : index;
        if (i < 0 || i >= c.getMediaItemCount()) return;
        MediaItem old = c.getMediaItemAt(i);
        MediaMetadata.Builder mb = old.mediaMetadata.buildUpon();
        if (o.has("title")) mb.setTitle(clip(o.optString("title"), 200));
        if (o.has("artist")) mb.setArtist(clip(o.optString("artist"), 200));
        if (o.has("album")) mb.setAlbumTitle(clip(o.optString("album"), 200));
        if (o.has("artwork")) art(mb, o.optString("artwork"));
        c.replaceMediaItem(i, old.buildUpon().setMediaMetadata(mb.build()).build());
    }

    // ---------------- parsing ----------------
    /** Relative paths resolve against https://vvvion.space; only https URLs are accepted (blob:/data:/http: cannot be played natively). */
    static Uri resolve(String u) {
        if (u == null) return null;
        u = u.trim();
        if (u.isEmpty() || u.length() > 4096) return null;
        Uri r = u.startsWith("/") && !u.startsWith("//") ? Uri.parse(MainActivity.HOME + u.substring(1)) : Uri.parse(u);
        return "https".equals(r.getScheme()) && r.getHost() != null ? r : null;
    }

    static MediaItem item(JSONObject o, boolean withArt) {
        Uri uri = resolve(o.optString("url", o.optString("src", "")));
        if (uri == null) return null;
        MediaMetadata.Builder mb = new MediaMetadata.Builder()
            .setTitle(clip(o.optString("title", ""), 200)).setArtist(clip(o.optString("artist", ""), 200)).setAlbumTitle(clip(o.optString("album", ""), 200));
        String art = o.optString("artwork", o.optString("cover", ""));
        if (!art.isEmpty() && (withArt || !art.startsWith("data:"))) art(mb, art);
        String id = o.optString("id", "");
        return new MediaItem.Builder().setMediaId(id.isEmpty() ? uri.toString() : clip(id, 300)).setUri(uri).setMediaMetadata(mb.build()).build();
    }

    private static void art(MediaMetadata.Builder mb, String art) {
        if (art == null || art.isEmpty()) return;
        if (art.startsWith("data:")) {
            byte[] jpg = smallJpeg(art);
            if (jpg != null) mb.setArtworkData(jpg, MediaMetadata.PICTURE_TYPE_FRONT_COVER);
        } else {
            Uri u = resolve(art);
            if (u != null) mb.setArtworkUri(u);
        }
    }

    /** data: URL -> <= 320 px JPEG (a few tens of KB: stays far below the Binder transaction limit). */
    static byte[] smallJpeg(String dataUrl) {
        try {
            int i = dataUrl.indexOf(',');
            byte[] b = Base64.decode(i >= 0 ? dataUrl.substring(i + 1) : dataUrl, Base64.DEFAULT);
            if (b.length > 3_000_000) return null;
            BitmapFactory.Options bo = new BitmapFactory.Options(); bo.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(b, 0, b.length, bo);
            if (bo.outWidth <= 0 || bo.outHeight <= 0) return null;
            int s = 1; while (Math.max(bo.outWidth, bo.outHeight) / (s * 2) >= ART_PX) s *= 2;
            BitmapFactory.Options o = new BitmapFactory.Options(); o.inSampleSize = s;
            Bitmap bm = BitmapFactory.decodeByteArray(b, 0, b.length, o);
            if (bm == null) return null;
            int w = bm.getWidth(), h = bm.getHeight(), m = Math.max(w, h);
            if (m > ART_PX) { float k = ART_PX / (float) m; Bitmap t = Bitmap.createScaledBitmap(bm, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)), true); if (t != bm) bm.recycle(); bm = t; }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bm.compress(Bitmap.CompressFormat.JPEG, 85, out); bm.recycle();
            return out.size() < 400_000 ? out.toByteArray() : null;
        } catch (Throwable t) { return null; }
    }

    static String clip(String s, int n) { return s == null ? "" : (s.length() > n ? s.substring(0, n) : s); }

    static int repeatOf(String m) { return "one".equals(m) ? Player.REPEAT_MODE_ONE : "all".equals(m) ? Player.REPEAT_MODE_ALL : Player.REPEAT_MODE_OFF; }
    static String repeatName(int m) { return m == Player.REPEAT_MODE_ONE ? "one" : m == Player.REPEAT_MODE_ALL ? "all" : "off"; }

    // ---------------- state -> page ----------------
    private static final class L implements Player.Listener {
        @Override public void onEvents(Player p, Player.Events e) {
            String ev = "state";
            if (e.contains(Player.EVENT_MEDIA_ITEM_TRANSITION)) ev = "track";
            else if (e.contains(Player.EVENT_PLAYBACK_STATE_CHANGED) && p.getPlaybackState() == Player.STATE_ENDED) ev = "ended";
            else if (e.contains(Player.EVENT_IS_PLAYING_CHANGED) || e.contains(Player.EVENT_PLAY_WHEN_READY_CHANGED)) ev = p.getPlayWhenReady() ? "play" : "pause";
            else if (e.contains(Player.EVENT_POSITION_DISCONTINUITY)) ev = "seek";
            else if (e.contains(Player.EVENT_TIMELINE_CHANGED) || e.contains(Player.EVENT_MEDIA_METADATA_CHANGED)) ev = "queue";
            else if (e.contains(Player.EVENT_PLAYBACK_STATE_CHANGED)) ev = p.getPlaybackState() == Player.STATE_BUFFERING ? "buffering" : "ready";
            refresh(ev);
        }
        @Override public void onPlayerError(PlaybackException e) {
            refresh("state");
            JSONObject o = json(snap, "error");
            try { o.put("errorCode", e.errorCode).put("errorName", e.getErrorCodeName()).put("message", clip(String.valueOf(e.getMessage()), 300)); } catch (Exception ignored) {}
            push(o);
        }
    }

    private static void refresh(String ev) {
        MediaController c = ctl;
        if (c == null || !c.isConnected()) return;
        Snap s = new Snap();
        s.count = c.getMediaItemCount();
        s.active = s.count > 0;
        s.index = s.active ? c.getCurrentMediaItemIndex() : -1;
        s.playWhenReady = c.getPlayWhenReady();
        s.playing = c.isPlaying();
        int st = c.getPlaybackState();
        s.state = st == Player.STATE_BUFFERING ? "buffering" : st == Player.STATE_READY ? "ready" : st == Player.STATE_ENDED ? "ended" : "idle";
        s.buffering = st == Player.STATE_BUFFERING && s.playWhenReady;
        s.repeat = c.getRepeatMode(); s.shuffle = c.getShuffleModeEnabled();
        MediaItem it = c.getCurrentMediaItem();
        if (it != null) {
            s.id = it.mediaId; s.url = it.localConfiguration != null ? String.valueOf(it.localConfiguration.uri) : "";
            s.title = String.valueOf(it.mediaMetadata.title == null ? "" : it.mediaMetadata.title);
            s.artist = String.valueOf(it.mediaMetadata.artist == null ? "" : it.mediaMetadata.artist);
            s.album = String.valueOf(it.mediaMetadata.albumTitle == null ? "" : it.mediaMetadata.albumTitle);
        }
        s.pos = Math.max(0, c.getCurrentPosition());
        long d = c.getDuration(); s.dur = d == C.TIME_UNSET ? 0 : Math.max(0, d);
        s.buffered = Math.max(0, c.getBufferedPosition());
        s.at = SystemClock.elapsedRealtime();
        boolean was = snap.playing;
        snap = s;
        live = s.active;
        Widgets.player(app, s.active, s.playing || s.buffering, s.title, s.artist, "native");
        if (s.playing) startTick();
        if (s.playing && !was) MainActivity.musicStarted();   // first sound: ask for the Android 13+ notification permission (once)
        if (ev != null) emit(ev);
    }

    private static void startTick() {
        if (ticking) return;
        ticking = true;
        main.postDelayed(new Runnable() {
            @Override public void run() {
                MediaController c = ctl;
                if (c == null || !c.isConnected() || !c.isPlaying()) { ticking = false; return; }
                if (!MainActivity.isForeground()) { ticking = false; return; }   // no page to talk to: resumed -> onAppResumed() restarts it
                refresh("progress");
                main.postDelayed(this, 1000);
            }
        }, 1000);
    }

    private static JSONObject json(Snap s, String ev) {
        JSONObject o = new JSONObject();
        try {
            long now = SystemClock.elapsedRealtime();
            long pos = s.playing ? s.pos + (now - s.at) : s.pos;
            if (s.dur > 0) pos = Math.min(pos, s.dur);
            o.put("event", ev).put("available", true).put("active", s.active).put("playing", s.playing).put("playWhenReady", s.playWhenReady)
                .put("buffering", s.buffering).put("state", s.state).put("index", s.index).put("count", s.count)
                .put("id", s.id).put("url", s.url).put("title", s.title).put("artist", s.artist).put("album", s.album)
                .put("positionMs", pos).put("durationMs", s.dur).put("bufferedMs", s.buffered)
                .put("repeat", repeatName(s.repeat)).put("shuffle", s.shuffle).put("updatedAt", System.currentTimeMillis());
        } catch (Exception ignored) {}
        return o;
    }

    private static void emit(String ev) { push(json(snap, ev)); }
    private static void error(String where, String msg) {
        try { push(json(snap, "error").put("errorName", where).put("message", clip(msg, 300))); } catch (Exception ignored) {}
    }
    private static void push(JSONObject o) { MainActivity.emitToPage(EVENT, o.toString()); }

    /** The activity came back to the front: let the page re-sync its UI from the real player state. */
    static void onAppResumed() { main.post(() -> { if (live) { refresh(null); emit("sync"); } }); }

    private static void gone() { ctl = null; fut = null; pending.clear(); live = false; snap = new Snap(); Widgets.player(app, false, false, "", "", ""); emit("stop"); }
    /** The service was destroyed (idle timeout, swipe while paused, stop): forget the controller. */
    static void onServiceGone() { main.post(() -> { if (ctl != null || fut != null || live) gone(); }); }
}
