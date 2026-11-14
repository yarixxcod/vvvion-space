package space.vvvion.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;
import java.io.File;
import java.io.FileNotFoundException;

/**
 * Minimal FileProvider replacement (no AndroidX dependency, not exported): hands the system camera / recorder a content:// URI
 * inside cacheDir/captures to write into, and lets the WebView read the result back. Nothing outside that folder is reachable.
 */
public final class CaptureProvider extends ContentProvider {
    static final String DIR = "captures";

    static String authority(Context c) { return c.getPackageName() + ".captures"; }

    static File dir(Context c) { File d = new File(c.getCacheDir(), DIR); if (!d.exists()) d.mkdirs(); return d; }

    /** A fresh, not yet existing file + the content:// URI that points to it. */
    static File newFile(Context c, String ext) {
        return new File(dir(c), "cap_" + System.currentTimeMillis() + "_" + (int) (Math.random() * 9999) + "." + ext);
    }

    static Uri uriFor(Context c, File f) {
        return new Uri.Builder().scheme("content").authority(authority(c)).appendPath(DIR).appendPath(f.getName()).build();
    }

    /** Deletes captures older than a day (called from a background thread at start). */
    static void cleanup(Context c) {
        File[] fs = dir(c).listFiles();
        if (fs == null) return;
        long old = System.currentTimeMillis() - 24L * 3600 * 1000;
        for (File f : fs) if (f.lastModified() < old) f.delete();
    }

    private File resolve(Uri uri) throws FileNotFoundException {
        try {
            if (uri.getPathSegments().size() != 2 || !DIR.equals(uri.getPathSegments().get(0))) throw new FileNotFoundException();
            File d = dir(getContext()).getCanonicalFile();
            File f = new File(d, uri.getLastPathSegment()).getCanonicalFile();
            if (!d.equals(f.getParentFile())) throw new FileNotFoundException();
            return f;
        } catch (FileNotFoundException e) { throw e; }
        catch (Exception e) { throw new FileNotFoundException(); }
    }

    @Override public boolean onCreate() { return true; }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(resolve(uri), ParcelFileDescriptor.parseMode(mode));
    }

    @Override public Cursor query(Uri uri, String[] proj, String sel, String[] args, String order) {
        try {
            File f = resolve(uri);
            String[] cols = proj != null ? proj : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
            MatrixCursor c = new MatrixCursor(cols, 1);
            Object[] row = new Object[cols.length];
            for (int i = 0; i < cols.length; i++) {
                if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
                else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
            }
            c.addRow(row);
            return c;
        } catch (FileNotFoundException e) { return null; }
    }

    @Override public String getType(Uri uri) {
        String n = uri.getLastPathSegment();
        int i = n == null ? -1 : n.lastIndexOf('.');
        String m = i > 0 ? MimeTypeMap.getSingleton().getMimeTypeFromExtension(n.substring(i + 1).toLowerCase()) : null;
        return m != null ? m : "application/octet-stream";
    }

    @Override public Uri insert(Uri u, ContentValues v) { return null; }
    @Override public int delete(Uri u, String s, String[] a) { return 0; }
    @Override public int update(Uri u, ContentValues v, String s, String[] a) { return 0; }
}
