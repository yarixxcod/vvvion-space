package space.vvvion.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Parcelable;
import android.provider.MediaStore;
import android.webkit.MimeTypeMap;
import android.webkit.WebChromeClient.FileChooserParams;
import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * Builds the system intent for <input type=file> (accept / multiple / capture) and maps the result back to what the WebView wants.
 * Camera and recorder go through the system apps (ACTION_IMAGE_CAPTURE / VIDEO_CAPTURE / RECORD_SOUND_ACTION), so the app needs NO CAMERA permission.
 */
final class Chooser {
    private Chooser() {}
    static final int REQ = 1;
    private static File pendingImg, pendingVid;

    /** @return the intent to start for result {@link #REQ}. */
    static Intent build(Activity a, FileChooserParams p) {
        boolean multiple = p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
        List<String> mimes = new ArrayList<>();
        boolean unknown = false;
        String[] acc = p.getAcceptTypes();
        if (acc != null) for (String chunk : acc) {
            if (chunk == null) continue;
            for (String s : chunk.split(",")) {
                s = s.trim().toLowerCase();
                if (s.isEmpty()) continue;
                if (s.startsWith(".")) {
                    String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(s.substring(1));
                    if (m == null) unknown = true; else if (!mimes.contains(m)) mimes.add(m);
                } else if (s.contains("/")) { if (!mimes.contains(s)) mimes.add(s); }
            }
        }
        boolean anyImg = false, anyVid = false, anyAud = false;
        for (String m : mimes) { anyImg |= m.startsWith("image/"); anyVid |= m.startsWith("video/"); anyAud |= m.startsWith("audio/"); }

        List<Intent> cams = new ArrayList<>();
        boolean cap = p.isCaptureEnabled();
        boolean none = mimes.isEmpty() && !unknown;
        if (anyImg || (cap && (none || mimes.contains("*/*")))) cams.add(imageIntent(a));
        if (anyVid) cams.add(videoIntent(a));
        if (cap && anyAud && !anyImg && !anyVid) cams.add(new Intent(MediaStore.Audio.Media.RECORD_SOUND_ACTION));

        if (cap && !cams.isEmpty()) {
            if (cams.size() == 1) return cams.get(0);
            Intent ch = Intent.createChooser(cams.get(0), null);
            ch.putExtra(Intent.EXTRA_INITIAL_INTENTS, cams.subList(1, cams.size()).toArray(new Parcelable[0]));
            return ch;
        }

        Intent get = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE);
        if (multiple) get.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        if (unknown || none) get.setType("*/*");
        else if (mimes.size() == 1) get.setType(mimes.get(0));
        else { get.setType("*/*"); get.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0])); }
        Intent ch = Intent.createChooser(get, null);
        if (!cams.isEmpty()) ch.putExtra(Intent.EXTRA_INITIAL_INTENTS, cams.toArray(new Parcelable[0]));
        return ch;
    }

    private static Intent imageIntent(Activity a) {
        pendingImg = CaptureProvider.newFile(a, "jpg");
        return withOutput(a, new Intent(MediaStore.ACTION_IMAGE_CAPTURE), pendingImg);
    }

    private static Intent videoIntent(Activity a) {
        pendingVid = CaptureProvider.newFile(a, "mp4");
        return withOutput(a, new Intent(MediaStore.ACTION_VIDEO_CAPTURE), pendingVid);
    }

    private static Intent withOutput(Activity a, Intent i, File f) {
        Uri u = CaptureProvider.uriFor(a, f);
        i.putExtra(MediaStore.EXTRA_OUTPUT, u);
        i.setClipData(ClipData.newRawUri("", u));
        i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {   // older camera apps ignore the clip: grant explicitly to every app that can handle the intent (needs <queries> in the manifest)
            for (ResolveInfo ri : a.getPackageManager().queryIntentActivities(i, PackageManager.MATCH_DEFAULT_ONLY))
                a.grantUriPermission(ri.activityInfo.packageName, u, Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {}
        return i;
    }

    /** Maps onActivityResult to the array for ValueCallback (null = cancelled). */
    static Uri[] result(Activity a, int res, Intent data) {
        File img = pendingImg, vid = pendingVid;
        pendingImg = null; pendingVid = null;
        try {
            if (res != Activity.RESULT_OK) return null;
            // a camera wrote into our file
            if (img != null && img.length() > 0) return new Uri[]{CaptureProvider.uriFor(a, img)};
            if (vid != null && vid.length() > 0) return new Uri[]{CaptureProvider.uriFor(a, vid)};
            Uri[] r = data != null ? FileChooserParams.parseResult(res, data) : null;
            if (r != null && r.length > 0) return r;
            return null;
        } finally {
            if (img != null && img.length() == 0) img.delete();
            if (vid != null && vid.length() == 0) vid.delete();
        }
    }
}
