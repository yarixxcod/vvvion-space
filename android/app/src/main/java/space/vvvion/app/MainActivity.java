package space.vvvion.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.graphics.Rect;
import android.graphics.Insets;
import android.os.Handler;
import android.os.Looper;
import android.view.Window;
import android.app.ActivityManager;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.view.HapticFeedbackConstants;
import android.view.animation.DecelerateInterpolator;
import android.net.ConnectivityManager;
import android.window.OnBackInvokedDispatcher;
import java.util.ArrayDeque;
import android.net.Network;
import android.os.SystemClock;
import android.provider.Settings;
import android.webkit.*;
import android.widget.FrameLayout;
import java.io.*;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    static final String HOME = "https://vvvion.space/";
    static final int BG = 0xFF0C0C0E;
    static final long LOADER_TIMEOUT_MS = 15000, LOADER_MIN_MS = 400, SPLASH_MAX_MS = 2500;
    /** Waits until the server-rendered page has visible content + fonts, then two frames, then hides the native loader. */
    static final String READY_JS = "(function(){if(window.__vvReady)return;window.__vvReady=1;var t0=Date.now();"
        + "function has(){var b=document.body;return !!b&&(b.innerText||'').trim().length>0&&b.getBoundingClientRect().height>0}"
        + "function go(){requestAnimationFrame(function(){requestAnimationFrame(function(){try{VVLoad.ready()}catch(e){}})})}"
        + "(function w(){if(document.readyState!=='loading'&&(has()||Date.now()-t0>4000)){var d=0;function f(){if(!d){d=1;go()}}"
        + "if(document.fonts&&document.fonts.ready)document.fonts.ready.then(f);setTimeout(f,1200)}else setTimeout(w,60)})()})()";
    static volatile MainActivity inst;
    /** True while the top-level page is https://vvvion.space (or a subdomain). The JS bridge ignores calls otherwise. */
    static volatile boolean trustedPage = false;
    boolean resumed = false, webPaused = false;
    AssetCache cache;
    Downloads downloads;
    OfflineScreen offline;
    View progressBar;
    boolean offlineVisible = false, splashHeld = true, navActive = false, barShown = false;
    int commits = 0;
    /** Site theme (meta[name=theme-color] / html.light) reported by the bridge; dark by default. */
    int themeColor = BG; boolean themeLight = false;
    int appliedBar = 0; boolean appliedLight = false;
    int[] lastPad = new int[4];
    boolean backPending = false;
    int kbPx = 0, kbSent = -1;
    static final ArrayDeque<String[]> consoleLog = new ArrayDeque<>();
    String wvVersion = "", wvPackage = ""; int wvMajor = 0;
    final Runnable backTimeout = () -> { if (backPending) { backPending = false; fallbackBack(); } };
    final Runnable kbR = this::sendKeyboard;
    long lastAutoRetry = 0, lastHaptic = 0;
    ConnectivityManager.NetworkCallback netCb;
    final Runnable splashTimeout = this::onSplashTimeout, showBarR = this::showBar;
    int launches = 0;
    boolean coldLoaderDone = false;
    static final long COLD_LOADER_MIN_MS = 1100;
    String bridgeJs;
    final BridgeCapability bridgeCapability = new BridgeCapability();
    WebView web;
    WebChromeClient chrome;
    FrameLayout root;
    View customView;
    WebChromeClient.CustomViewCallback customCb;
    ValueCallback<Uri[]> fileCb;
    PermissionRequest pendingPerm;
    final Map<String, String> bundled = new HashMap<>();
    PullToRefresh ptr;
    Updater updater;
    final Handler ui = new Handler(Looper.getMainLooper());
    WebView loaderWeb;
    boolean loaderVisible = false, mainFailed = false;
    long loaderShownAt = 0;
    String failedUrl;
    volatile String loaderState = "loading", loaderMsg = "";
    final Runnable loaderTimeout = this::onLoaderTimeout;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        inst = this;
        // warm up DNS for the site while the WebView is still being created
        new Thread(() -> { try { java.net.InetAddress.getAllByName("vvvion.space"); } catch (Exception ignored) {} }, "vv-dns").start();
        cache = new AssetCache(this);
        downloads = new Downloads(this);
        loadIndex();
        loadBridgeJs();
        SharedPreferences ap = getSharedPreferences("app", Context.MODE_PRIVATE);
        launches = ap.getInt("launches", 0) + 1; ap.edit().putInt("launches", launches).apply();
        AppNotifier.ensureChannels(this);
        themeColor = ap.getInt("themeColor", BG); themeLight = ap.getBoolean("themeLight", false);   // last site theme, applied once the launch loader is gone (no flash)
        new Thread(() -> { try { CaptureProvider.cleanup(this); } catch (Exception ignored) {} }, "vv-clean").start();
        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        root.getOverlay().add(topScrim);
        root.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or2, ob) -> topScrim.setBounds(0, 0, r - l, root.getPaddingTop()));
        web = new WebView(this);
        web.setBackgroundColor(BG);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        holdSplash();
        getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(BG));
        getWindow().getDecorView().setBackgroundColor(BG);
        setupFullscreen();
        ptr = new PullToRefresh(root, web);
        setupLoader();   // drawn above the WebView and the pull-to-refresh spinner
        progressBar = new View(this);
        progressBar.setBackgroundColor(0xFFC4B5E8);
        progressBar.setPivotX(0f);
        progressBar.setVisibility(View.GONE);
        root.addView(progressBar, new FrameLayout.LayoutParams(-1, Math.max(2, (int) (2 * getResources().getDisplayMetrics().density + 0.5f)), Gravity.TOP));
        offline = new OfflineScreen(this, this::retryLoad);
        root.addView(offline, new FrameLayout.LayoutParams(-1, -1));   // above everything
        updater = new Updater(this);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        // Hybrid shell: never allow HTTP resources inside the authenticated HTTPS app.
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Touch / layout sanity: the page's own viewport meta rules, the system font scale must not rescale the layout,
        // no pinch / double-tap zoom (accidental zoom on a laggy frame looks like "jumpy" input).
        s.setTextZoom(100);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        s.setUserAgentString(s.getUserAgentString() + " vvvionApp/3.0" + (isTablet() ? " VvvionTablet" : ""));
        if (Build.VERSION.SDK_INT >= 23) s.setOffscreenPreRaster(true);
        if (Build.VERSION.SDK_INT >= 26) web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        if (Build.VERSION.SDK_INT >= 26) { web.setDefaultFocusHighlightEnabled(false); loaderWeb.setDefaultFocusHighlightEnabled(false); }
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        detectWebView();
        if (Build.VERSION.SDK_INT >= 33) {   // predictive-back compatible: the app opts in (manifest) and handles back itself
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        ui.postDelayed(this::maybeWebViewHint, 6000);
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface public void ready() { ui.post(MainActivity.this::onPageReady); }
        }, "VVLoad");
        web.addJavascriptInterface(new Bridge(this), "VvvionNative");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                if (!"GET".equals(r.getMethod())) return null;
                String path = bundled.get(r.getUrl().toString());
                if (path == null) return cache != null ? cache.get(r) : null;   // disk cache for static site files
                try {
                    InputStream in = getAssets().open(path);
                    Map<String, String> h = new HashMap<>();
                    h.put("Access-Control-Allow-Origin", "*");
                    // content-hashed build files and Google font files never change under the same name; plain files (icons, persona art) may
                    h.put("Cache-Control", path.startsWith("www/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600");
                    return new WebResourceResponse(mime(path), mime(path).startsWith("text") || path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".svg") ? "utf-8" : null, 200, "OK", h, in);
                } catch (IOException e) { return null; }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                // Subframe navigations must not launch external apps or change top-level trust.
                if (!r.isForMainFrame()) return false;
                Uri u = r.getUrl();
                String host = u.getHost();
                if (isTrusted(u.toString())) return false;
                openExternal(u);
                return true;
            }
            @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap fav) {
                if (failedUrl == null || !failedUrl.equals(url)) mainFailed = false;
                bridgeCapability.rotate();
                trustedPage = isTrusted(url); inject(v);
                navStart();
            }
            @Override public void doUpdateVisitedHistory(WebView v, String url, boolean reload) { trustedPage = isTrusted(url); }
            @Override public void onPageCommitVisible(WebView v, String url) {
                inject(v);
                if (loaderVisible && !mainFailed) v.evaluateJavascript(READY_JS, null);
                else if (!loaderVisible && !splashHeld && !offlineVisible && commits > 0) fadeWeb(0.55f, 150);   // subtle cross-fade on full page loads
                commits++;
            }
            @Override public void onPageFinished(WebView v, String url) {
                if (loaderVisible && !mainFailed) v.evaluateJavascript(READY_JS, null);
                v.evaluateJavascript(PullToRefresh.JS, null);
                ptr.done();
                navEnd();
                inject(v);   // tap-highlight CSS + VvvionApp bridge + media hooks (idempotent)
                kbSent = -1; sendKeyboard();   // new document: CSS var --vv-kb / class vv-kb-open start from the real state
            }
            @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detail) {
                // Android can kill the Chromium renderer under memory pressure. A dead WebView
                // cannot be reused: discard it and restart the Activity on the UI thread.
                trustedPage = false;
                if (fileCb != null) { fileCb.onReceiveValue(null); fileCb = null; }
                if (pendingPerm != null) { try { pendingPerm.deny(); } catch (Exception ignored) {} pendingPerm = null; }
                if (v.getParent() instanceof ViewGroup) ((ViewGroup) v.getParent()).removeView(v);
                v.destroy();
                long now = SystemClock.elapsedRealtime();
                SharedPreferences crash = getSharedPreferences("webview_recovery", MODE_PRIVATE);
                long previous = crash.getLong("last", 0L);
                int attempts = now - previous < 60000L ? crash.getInt("count", 0) + 1 : 1;
                crash.edit().putLong("last", now).putInt("count", attempts).apply();
                if (attempts <= 2) {
                    ui.post(() -> { if (!isFinishing() && !isDestroyed()) recreate(); });
                } else {
                    // Avoid an infinite crash/restart loop on a broken WebView installation.
                    ui.post(() -> {
                        if (!isFinishing() && !isDestroyed()) {
                            new android.app.AlertDialog.Builder(MainActivity.this)
                                .setTitle("WebView недоступен")
                                .setMessage("Android System WebView завершился несколько раз. Обновите Android System WebView или Chrome и откройте VVVion Space снова.")
                                .setPositiveButton("Закрыть", (d, which) -> finish())
                                .setCancelable(false).show();
                        }
                    });
                }
                return true;
            }
            @Override public void onReceivedSslError(WebView v, SslErrorHandler handler, android.net.http.SslError error) {
                // Certificate errors must never be bypassed, even when offline or reconnecting.
                handler.cancel();
                mainFailed = true;
                failedUrl = error == null ? null : error.getUrl();
                showOfflineScreen(failedUrl == null ? HOME : failedUrl);
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (!r.isForMainFrame()) return;   // sub-resource errors (and HTTP 4xx/5xx) never trigger the offline screen
                String url = r.getUrl().toString();
                if (isNetworkError(e.getErrorCode())) { showOfflineScreen(url); return; }
                mainFailed = true; failedUrl = url; releaseSplash(false); showLoader(true, null); ptr.done(); navEnd();
            }
        });
        web.setWebChromeClient(chrome = new WebChromeClient() {
            @Override public void onProgressChanged(WebView v, int p) { onProgress(p); }
            /** beta3: without these the WebView draws its own grey/white default poster / spinner square when a media element starts. */
            @Override public android.graphics.Bitmap getDefaultVideoPoster() {
                return android.graphics.Bitmap.createBitmap(new int[]{0}, 1, 1, android.graphics.Bitmap.Config.ARGB_8888);
            }
            @Override public View getVideoLoadingProgressView() {
                View v = new View(MainActivity.this); v.setBackgroundColor(Color.TRANSPARENT); return v;
            }
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try { startActivityForResult(Chooser.build(MainActivity.this, p), Chooser.REQ); }
                catch (Exception ex) { fileCb = null; cb.onReceiveValue(null); return true; }
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest req) { handlePermissionRequest(req); }
            @Override public void onPermissionRequestCanceled(PermissionRequest req) { if (pendingPerm == req) pendingPerm = null; }
            @Override public boolean onJsAlert(WebView v, String url, String msg, android.webkit.JsResult r) { return jsDialog(url, msg, 0, null, r); }
            @Override public boolean onJsConfirm(WebView v, String url, String msg, android.webkit.JsResult r) { return jsDialog(url, msg, 1, null, r); }
            @Override public boolean onJsPrompt(WebView v, String url, String msg, String def, android.webkit.JsPromptResult r) { return jsDialog(url, msg, 2, def == null ? "" : def, r); }
            @Override public boolean onConsoleMessage(ConsoleMessage m) {
                if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) logConsole(m.message(), m.sourceId(), m.lineNumber());
                return false;
            }
            @Override public void onShowCustomView(View view, CustomViewCallback cb) {
                if (customView != null) { cb.onCustomViewHidden(); return; }
                customView = view; customCb = cb;
                view.setBackgroundColor(Color.BLACK); view.setKeepScreenOn(true);
                root.addView(view, new FrameLayout.LayoutParams(-1, -1));
                web.setVisibility(View.GONE);
                setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR);   // let the video rotate even with the system rotation lock on
                reapplyPadding(); applyBarColors(); hideBars();
            }
            @Override public void onHideCustomView() {
                if (customView == null) return;
                customView.setKeepScreenOn(false);
                root.removeView(customView);
                customView = null; web.setVisibility(View.VISIBLE);
                if (customCb != null) { try { customCb.onCustomViewHidden(); } catch (Exception ignored) {} customCb = null; }
                setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                reapplyPadding(); applyBarColors(); hideBars();
            }
        });
        web.setDownloadListener((url, ua, cd, mt, len) -> downloads.onDownloadStart(url, ua, cd, mt, len));

        if (state == null || web.restoreState(state) == null) {
            Uri data = getIntent().getData();
            web.loadUrl(data != null ? safeUrl(data).toString() : HOME);
        }
        PushStore.init(this);
        registerNet();
    }

    int imeBottom = 0, cutTop = 0;
    /** Opaque dark plate drawn ABOVE the WebView over the whole top padding (status-bar / cutout strip). Whatever the
     *  system or an OEM paints behind a visible status bar (Material-You surface, windowBackgroundFallback, ...), this wins. */
    final android.graphics.drawable.ColorDrawable topScrim = new android.graphics.drawable.ColorDrawable(BG);

    void setRootPadding(int l, int t, int r, int b) {
        lastPad[0] = l; lastPad[1] = t; lastPad[2] = r; lastPad[3] = b;
        if (customView != null) { l = t = r = b = 0; }   // fullscreen video: edge to edge, no status-bar strip, no keyboard padding
        root.setPadding(l, t, r, b);
        topScrim.setBounds(0, 0, Math.max(root.getWidth(), getResources().getDisplayMetrics().widthPixels), t);
        root.invalidate();
    }

    void reapplyPadding() { setRootPadding(lastPad[0], lastPad[1], lastPad[2], lastPad[3]); }

    /** The colour of everything behind the page: the site theme, but always dark while a native dark overlay (launch loader, offline screen,
     *  fullscreen video) is on top, so the strip never mismatches what is under it. */
    int barColor() { return (splashHeld || loaderVisible || offlineVisible || customView != null) ? BG : themeColor; }
    boolean barLight() { return !(splashHeld || loaderVisible || offlineVisible || customView != null) && themeLight; }

    /** Site theme from the injected script (meta[name=theme-color] / html.light). Untrusted pages are filtered in Bridge. */
    void setTheme(String color, boolean light) {
        int c;
        try { c = 0xFF000000 | (Color.parseColor(color) & 0xFFFFFF); } catch (Exception e) { return; }
        if (color == null || color.length() != 7) return;
        if (c == themeColor && light == themeLight) return;
        themeColor = c; themeLight = light;
        getSharedPreferences("app", Context.MODE_PRIVATE).edit().putInt("themeColor", c).putBoolean("themeLight", light).apply();
        applyBarColors();
        if (Build.VERSION.SDK_INT < 30) hideBars();   // re-sets the legacy system-UI flags including the light-icon bits
    }

    final android.graphics.drawable.ColorDrawable winBg = new android.graphics.drawable.ColorDrawable(BG);

    /** Re-asserts every colour the window could show behind/around the page. Cheap and idempotent, so it is safe in the insets listener. */
    void applyBarColors() {
        Window w = getWindow();
        final int bc = barColor(); final boolean lt = barLight();
        if (appliedBar != bc) {
            appliedBar = bc;
            topScrim.setColor(bc); winBg.setColor(bc);
            if (root != null) root.setBackgroundColor(bc);
            if (web != null) web.setBackgroundColor(bc);
            w.getDecorView().setBackgroundColor(bc);
        }
        if (w.getStatusBarColor() != bc) w.setStatusBarColor(bc);
        if (w.getNavigationBarColor() != bc) w.setNavigationBarColor(bc);
        if (Build.VERSION.SDK_INT >= 28 && w.getNavigationBarDividerColor() != bc) w.setNavigationBarDividerColor(bc);
        w.setBackgroundDrawable(winBg);   // same instance -> PhoneWindow ignores repeats
        View d = w.getDecorView();
        android.graphics.drawable.Drawable bg = d.getBackground();
        if (!(bg instanceof android.graphics.drawable.ColorDrawable) || ((android.graphics.drawable.ColorDrawable) bg).getColor() != bc) d.setBackgroundColor(bc);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = w.getInsetsController();
            final int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            if (c != null && (c.getSystemBarsAppearance() & mask) != (lt ? mask : 0)) c.setSystemBarsAppearance(lt ? mask : 0, mask);
        } else if (Build.VERSION.SDK_INT >= 23) {
            int f = d.getSystemUiVisibility() & ~(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | (Build.VERSION.SDK_INT >= 26 ? View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0));
            f |= lightFlags();
            if (f != d.getSystemUiVisibility()) d.setSystemUiVisibility(f);
        }
        appliedLight = lt;
    }

    int lightFlags() {
        if (!barLight()) return 0;
        return View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | (Build.VERSION.SDK_INT >= 26 ? View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0);
    }

    void setupFullscreen() {
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        if (Build.VERSION.SDK_INT >= 28) setTaskDescription(new ActivityManager.TaskDescription("VVVion Space", null, Color.parseColor("#0c0c0e")));
        Window w = getWindow();
        w.setStatusBarColor(BG);
        w.setNavigationBarColor(BG);
        if (Build.VERSION.SDK_INT >= 28) w.setNavigationBarDividerColor(BG);
        if (Build.VERSION.SDK_INT >= 29) { w.setStatusBarContrastEnforced(false); w.setNavigationBarContrastEnforced(false); }
        if (Build.VERSION.SDK_INT >= 30) {
            w.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN); // legacy flag fights the insets controller when the IME opens
            w.setDecorFitsSystemWindows(false);
            WindowInsetsController c = w.getInsetsController();
            if (c != null) c.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            root.setOnApplyWindowInsetsListener((v, ins) -> {
                boolean imeVis = ins.isVisible(WindowInsets.Type.ime());
                // Only the keyboard may push content, and only from the bottom. Status/nav bars never add padding.
                int ime = imeVis ? ins.getInsets(WindowInsets.Type.ime()).bottom : 0;
                Insets cut = ins.getInsetsIgnoringVisibility(WindowInsets.Type.displayCutout());
                // When the IME forces the status bar visible, pad the top by its height so the
                // page is pushed below it and the strip shows the dark root background, not a white bar.
                int top = cut.top;
                if (ins.isVisible(WindowInsets.Type.statusBars()))
                    top = Math.max(top, ins.getInsets(WindowInsets.Type.statusBars()).top);
                setRootPadding(cut.left, top, cut.right, ime);
                applyBarColors();
                boolean changed = (ime > 0) != (imeBottom > 0); imeBottom = ime;
                postKeyboard(ime);
                if (changed) reHideBars();   // the IME reveals the bars on many devices -> hide again, both on open and close
                else if (ins.isVisible(WindowInsets.Type.statusBars())) { ui.removeCallbacks(hideBarsR); ui.postDelayed(hideBarsR, 2500); }
                return WindowInsets.CONSUMED;
            });
        } else {
            root.getViewTreeObserver().addOnGlobalLayoutListener(() -> {
                Rect r = new Rect();
                root.getWindowVisibleDisplayFrame(r);
                int h = root.getRootView().getHeight();
                int ime = h - r.bottom; if (ime < h / 6) ime = 0;
                int cut = 0;
                if (Build.VERSION.SDK_INT >= 28 && root.getRootWindowInsets() != null && root.getRootWindowInsets().getDisplayCutout() != null)
                    cut = root.getRootWindowInsets().getDisplayCutout().getSafeInsetTop();
                int topPad = cut;
                if (ime > 0) {
                    int sb = 0, resId = getResources().getIdentifier("status_bar_height", "dimen", "android");
                    if (resId > 0) sb = getResources().getDimensionPixelSize(resId);
                    topPad = Math.max(cut, sb);   // keyboard open: keep the status-bar strip dark
                }
                if (ime != imeBottom || cut != cutTop) {
                    boolean wasOpen = imeBottom > 0; imeBottom = ime; cutTop = cut;
                    postKeyboard(ime);
                    setRootPadding(0, topPad, 0, ime);   // top = cutout / status bar, bottom = keyboard only
                    applyBarColors();
                    if (wasOpen != (ime > 0)) reHideBars();
                }
            });
            getWindow().getDecorView().setOnSystemUiVisibilityChangeListener(vis -> {
                if ((vis & View.SYSTEM_UI_FLAG_FULLSCREEN) == 0) { ui.removeCallbacks(hideBarsR); ui.postDelayed(hideBarsR, 600); }
            });
        }
        hideBars();
    }

    final Runnable hideBarsR = this::hideBars;
    void reHideBars() { ui.removeCallbacks(hideBarsR); ui.post(hideBarsR); ui.postDelayed(hideBarsR, 350); }

    void hideBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | lightFlags());
        }
    }

    @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) hideBars(); }

    // ---------- tablet support (2.9.2) ----------
    /** Physical device class: the shorter side of the whole display is >= 600 dp. Independent of rotation and of split-screen, so it is stable for the process. */
    boolean isTablet() { return shortestSideDp() >= 600; }

    int shortestSideDp() {
        try {
            float d = getResources().getDisplayMetrics().density;
            int w, h;
            if (Build.VERSION.SDK_INT >= 30) { Rect b = getWindowManager().getMaximumWindowMetrics().getBounds(); w = b.width(); h = b.height(); }
            else { android.util.DisplayMetrics m = new android.util.DisplayMetrics(); getWindowManager().getDefaultDisplay().getRealMetrics(m); w = m.widthPixels; h = m.heightPixels; }
            return Math.round(Math.min(w, h) / d);
        } catch (Exception e) { return getResources().getConfiguration().smallestScreenWidthDp; }
    }

    /** {tablet, smallestWidthDp, widthDp, heightDp, landscape} -- window size in the current orientation / split-screen. */
    String screenJson() {
        android.content.res.Configuration c = getResources().getConfiguration();
        try {
            return new org.json.JSONObject().put("tablet", isTablet()).put("smallestWidthDp", shortestSideDp())
                .put("widthDp", c.screenWidthDp).put("heightDp", c.screenHeightDp)
                .put("landscape", c.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE).toString();
        } catch (Exception e) { return "{}"; }
    }

    /** Rotation / split-screen / fold: the manifest keeps the activity alive (no recreate, no WebView reload); tell the page. */
    @Override public void onConfigurationChanged(android.content.res.Configuration nc) {
        super.onConfigurationChanged(nc);
        if (web != null && trustedPage) web.evaluateJavascript("window.__vvScreen&&window.__vvScreen(" + screenJson() + ")", null);
        hideBars();
    }

    // ---------- launch loader (copy of the site's .vv-loader, bundled in assets/loader) ----------
    void setupLoader() {
        loaderWeb = new WebView(this);
        loaderWeb.setBackgroundColor(BG);
        loaderWeb.setOverScrollMode(View.OVER_SCROLL_NEVER);
        loaderWeb.setVerticalScrollBarEnabled(false); loaderWeb.setHorizontalScrollBarEnabled(false);
        loaderWeb.setLongClickable(false); loaderWeb.setOnLongClickListener(v -> true); loaderWeb.setHapticFeedbackEnabled(false);
        loaderWeb.getSettings().setJavaScriptEnabled(true);
        loaderWeb.getSettings().setAllowFileAccess(false); // file:///android_asset stays readable
        loaderWeb.addJavascriptInterface(new Object() {
            @JavascriptInterface public void retry() { ui.post(MainActivity.this::retryLoad); }
            @JavascriptInterface public String state() { return loaderState; }
            @JavascriptInterface public String message() { return loaderMsg; }
        }, "VVApp");
        loaderWeb.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return true; }
        });
        loaderWeb.loadUrl("file:///android_asset/loader/loader.html");
        root.addView(loaderWeb, new FrameLayout.LayoutParams(-1, -1));
        loaderVisible = true; loaderShownAt = System.currentTimeMillis();
        ui.postDelayed(loaderTimeout, LOADER_TIMEOUT_MS);
    }

    void showLoader(boolean error, String msg) {
        if (loaderWeb == null) return;
        loaderWeb.animate().cancel();
        if (!loaderVisible) { loaderShownAt = System.currentTimeMillis(); loaderWeb.onResume(); }
        loaderVisible = true; applyBarColors();
        loaderWeb.setAlpha(1f); loaderWeb.setVisibility(View.VISIBLE);
        loaderState = error ? "error" : "loading"; loaderMsg = msg == null ? "" : msg;   // read by loader.html on its own load
        String m = msg == null ? "null" : org.json.JSONObject.quote(msg);
        loaderWeb.evaluateJavascript("window.vvState&&vvState('" + (error ? "error" : "loading") + "'," + m + ")", null);
        ui.removeCallbacks(loaderTimeout);
        if (!error) ui.postDelayed(loaderTimeout, LOADER_TIMEOUT_MS);
    }

    void onPageReady() {
        if (!loaderVisible || mainFailed) return;
        if (splashHeld) releaseSplash(false);   // beta2: always show the full-screen launch loader, even when bundled assets make the page ready instantly
        long wait = (coldLoaderDone ? LOADER_MIN_MS : COLD_LOADER_MIN_MS) - (System.currentTimeMillis() - loaderShownAt);
        if (wait > 0) { ui.postDelayed(this::onPageReady, wait); return; }
        coldLoaderDone = true;
        hideLoader();
        if (launches >= 2) ui.postDelayed(() -> askNotifications(false), 3000);   // from the 2nd launch on, once
    }

    void hideLoader() {
        if (!loaderVisible) return;
        loaderVisible = false; applyBarColors();
        ui.removeCallbacks(loaderTimeout);
        loaderWeb.animate().alpha(0f).setDuration(280).withEndAction(() -> {
            if (!loaderVisible) { loaderWeb.setVisibility(View.GONE); loaderWeb.onPause(); }
        }).start();
    }

    void onLoaderTimeout() {
        if (!loaderVisible || mainFailed) return;
        if (!isOnline()) { showOfflineScreen(web.getUrl() != null ? web.getUrl() : HOME); return; }
        if (web.getProgress() >= 50) hideLoader();   // slow but alive: show whatever the site has drawn
        else { mainFailed = true; failedUrl = web.getUrl(); web.stopLoading();
               showLoader(true, "Сайт долго не отвечает. Проверь интернет и попробуй ещё раз."); }
    }

    void retryLoad() {
        String u = failedUrl != null ? failedUrl : (web.getUrl() != null ? web.getUrl() : HOME);
        if (!u.startsWith("https://")) u = HOME;
        mainFailed = false; failedUrl = null;
        hideOfflineScreen();
        showLoader(false, null);
        web.loadUrl(u);
    }

    void loadIndex() {
        try (BufferedReader br = new BufferedReader(new InputStreamReader(getAssets().open("index.txt"), "UTF-8"))) {
            String line;
            while ((line = br.readLine()) != null) {
                int t = line.indexOf('\t');
                if (t > 0) bundled.put(line.substring(0, t), line.substring(t + 1));
            }
        } catch (IOException ignored) {}
    }

    static String mime(String p) {
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".avif")) return "image/avif";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".jpg")) return "image/jpeg";
        if (p.endsWith(".html")) return "text/html";
        return "application/octet-stream";
    }

    void showOffline() {
        try (InputStream in = getAssets().open("www/offline.html")) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[8192]; int n;
            while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
            web.loadDataWithBaseURL(HOME + "offline.html", b.toString("UTF-8"), "text/html", "utf-8", null);
        } catch (IOException ignored) {}
    }

    private static final java.util.Set<String> NO_EXTERNAL = new java.util.HashSet<>(java.util.Arrays.asList(
        "file", "content", "javascript", "data", "blob", "about", "vbscript", "ws", "wss", "ftp", "filesystem"));
    private static final String[] TG_PACKAGES = {"org.telegram.messenger", "org.telegram.messenger.web", "org.thunderdog.challegram", "org.telegram.plus"};

    static boolean isTelegramLink(Uri u) {
        String sc = u.getScheme() == null ? "" : u.getScheme().toLowerCase(java.util.Locale.ROOT);
        if (sc.equals("tg")) return true;
        String h = u.getHost() == null ? "" : u.getHost().toLowerCase(java.util.Locale.ROOT);
        return sc.equals("https") && (h.equals("t.me") || h.equals("telegram.me") || h.equals("telegram.dog") || h.equals("www.t.me"));
    }

    /** 3.0.0: hands a link to another app. tg: and t.me go to the Telegram app first (browser if it is not installed); intent: links use their
     *  browser_fallback_url when the app is missing. No file/content/javascript/data schemes. Returns false when nothing could open it. */
    boolean openExternal(Uri u) {
        if (u == null || u.getScheme() == null) return false;
        String sc = u.getScheme().toLowerCase(java.util.Locale.ROOT);
        // Never dispatch untrusted custom schemes to other apps. Explicitly allow only
        // web, email, phone and Telegram links; intent: is handled separately below.
        if (!(sc.equals("https") || sc.equals("http") || sc.equals("mailto")
                || sc.equals("tel") || sc.equals("tg") || sc.equals("intent"))) return false;
        if (NO_EXTERNAL.contains(sc)) return false;
        try {
            if ("intent".equals(sc)) {
                Intent parsed = Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME);
                String fallback = parsed.getStringExtra("browser_fallback_url");
                Uri target = fallback == null ? null : Uri.parse(fallback);
                return target != null && "https".equals(target.getScheme()) && openExternal(target);
            }
            if (isTelegramLink(u)) {
                for (String pkg : TG_PACKAGES) {
                    try {
                        Intent t = new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE).setPackage(pkg);
                        startActivity(t); return true;
                    } catch (ActivityNotFoundException ignored) {}
                }
            }
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            i.addCategory(Intent.CATEGORY_BROWSABLE); i.setComponent(null); i.setSelector(null);
            startActivity(i);
            return true;
        } catch (Exception e) { return false; }
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent.getData() != null) navigateTo(safeUrl(intent.getData()));
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        if (req == Chooser.REQ) {
            Uri[] r = Chooser.result(this, res, data);
            if (fileCb != null) { fileCb.onReceiveValue(r); fileCb = null; }
        } else super.onActivityResult(req, res, data);
    }

    Uri[] multi(int res, Intent data) {
        if (res != RESULT_OK || data == null) return null;
        if (data.getClipData() != null) {
            Uri[] out = new Uri[data.getClipData().getItemCount()];
            for (int i = 0; i < out.length; i++) out[i] = data.getClipData().getItemAt(i).getUri();
            return out;
        }
        return data.getData() != null ? new Uri[]{data.getData()} : null;
    }

    @Override public void onRequestPermissionsResult(int code, String[] p, int[] r) {
        if (code == 3) { emitNotificationState(); return; }
        if (code == Downloads.REQ_STORAGE) { downloads.onPermissionResult(r.length > 0 && r[0] == PackageManager.PERMISSION_GRANTED); return; }
        if (code == 2 && pendingPerm != null) {
            PermissionRequest pr = pendingPerm; pendingPerm = null;
            try { if (r.length > 0 && r[0] == PackageManager.PERMISSION_GRANTED && isTrusted(pr.getOrigin().toString())) pr.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE}); else pr.deny(); } catch (Exception ignored) {}
        }
    }

    // 2.9.1: the bridge dispatcher (site handler + Circle sub-screen fallback) when present, else the site handler alone
    static final String BACK_JS = "(function(){try{var f=window.__vvBackDispatch||window.__vvvionHandleBack;return !!f&&f()===true}catch(e){return false}})()";

    /** Android 13+ goes through OnBackInvokedCallback (predictive-back opt-in in the manifest), older versions through onBackPressed. */
    @Override public void onBackPressed() { handleBack(); }

    void handleBack() {
        if (customView != null) { chrome.onHideCustomView(); return; }
        if (offlineVisible || (loaderVisible && mainFailed)) {
            hideOfflineScreen();
            if (web.canGoBack()) { mainFailed = false; failedUrl = null; hideLoader(); web.goBack(); } else fallbackBack();
            return;
        }
        if (backPending) return;   // a previous press is still waiting for the page's answer
        if (trustedPage && !loaderVisible && web.getUrl() != null) {
            // 1) let the site close its top layer (sheet, sidebar, popover, lightbox, Circle sub-screen): it answers true when it consumed the press
            backPending = true;
            ui.removeCallbacks(backTimeout); ui.postDelayed(backTimeout, 700);
            web.evaluateJavascript(BACK_JS, r -> {
                if (!backPending) return;   // already timed out
                backPending = false; ui.removeCallbacks(backTimeout);
                if (!"true".equals(r)) fallbackBack();
            });
            return;
        }
        fallbackBack();
    }

    /** Called by the bridge when a back press it consumed changed nothing (400 ms): run the default so the user is never trapped. */
    void backDefault() { ui.post(() -> { backPending = false; if (!offlineVisible) fallbackBack(); }); }

    /** 2) WebView history  3) minimise while music plays  4) system default (leave / move task to back). */
    void fallbackBack() {
        if (web.canGoBack()) web.goBack();
        else if (MediaPlaybackService.active() && MediaPlaybackService.state.playing) moveTaskToBack(true);   // keep the music going
        else MainActivity.super.onBackPressed();
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onPause() {
        super.onPause(); resumed = false;
        // While the music service is alive the WebView must keep running, otherwise the stream is throttled/stopped.
        if (!MediaPlaybackService.active()) { web.onPause(); webPaused = true; }
        CookieManager.getInstance().flush();
    }
    @Override protected void onResume() {
        super.onResume(); resumed = true; web.onResume(); webPaused = false; applyBarColors(); hideBars(); if (updater != null) updater.onResume();
        emitNotificationState();
        NativePlayer.onAppResumed();
        Widgets.refreshOnResume(this);
    }
    @Override protected void onStop() { super.onStop(); CookieManager.getInstance().flush(); }
    @Override protected void onDestroy() {
        VvDialog.dismissActive();
        if (netCb != null) { try { getSystemService(ConnectivityManager.class).unregisterNetworkCallback(netCb); } catch (Exception ignored) {} netCb = null; }
        if (inst == this) inst = null;
        trustedPage = false;
        bridgeCapability.rotate();
        MediaPlaybackService.stop(this);
        if (downloads != null) downloads.close();
        ui.removeCallbacksAndMessages(null);
        try { root.removeAllViews(); if (web != null) web.destroy(); if (loaderWeb != null) loaderWeb.destroy(); } catch (Exception ignored) {}
        super.onDestroy();
    }

    // ---------- 2.9.0: permissions, console log, WebView version, keyboard, share ----------
    /** getUserMedia: only the top-level vvvion.space page, only microphone (the app has no CAMERA permission by design:
     *  photos / video go through the system camera app in the file chooser). Asks the runtime permission when needed. */
    void handlePermissionRequest(PermissionRequest req) {
        boolean origin = false;
        try { origin = trustedPage && isTrusted(req.getOrigin().toString()); } catch (Exception ignored) {}
        // Reject combined or unexpected resource requests; never implicitly grant camera,
        // protected media IDs or future WebView permission types alongside the mic.
        String[] resources = req.getResources();
        boolean audioOnly = resources != null && resources.length == 1
            && PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resources[0]);
        if (!origin || !audioOnly) { req.deny(); return; }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            req.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            if (pendingPerm != null) { try { pendingPerm.deny(); } catch (Exception ignored) {} }
            pendingPerm = req;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 2);
        }
    }

    void logConsole(String msg, String src, int line) {
        if (msg == null) msg = "";
        if (msg.length() > 600) msg = msg.substring(0, 600) + "…";
        if (src == null) src = "";
        if (src.length() > 200) src = src.substring(src.length() - 200);
        android.util.Log.e("VVWeb", msg + " (" + src + ":" + line + ")");
        synchronized (consoleLog) {
            consoleLog.addLast(new String[]{String.valueOf(System.currentTimeMillis()), msg, src, String.valueOf(line)});
            while (consoleLog.size() > 50) consoleLog.removeFirst();
        }
    }

    static String consoleLogJson() {
        org.json.JSONArray a = new org.json.JSONArray();
        synchronized (consoleLog) {
            for (String[] e : consoleLog) {
                try { a.put(new org.json.JSONObject().put("t", Long.parseLong(e[0])).put("msg", e[1]).put("src", e[2]).put("line", Integer.parseInt(e[3]))); } catch (Exception ignored) {}
            }
        }
        return a.toString();
    }

    void detectWebView() {
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                android.content.pm.PackageInfo pi = WebView.getCurrentWebViewPackage();
                if (pi != null) { wvVersion = pi.versionName == null ? "" : pi.versionName; wvPackage = pi.packageName == null ? "" : pi.packageName; }
            }
            if (wvVersion.isEmpty()) {
                java.util.regex.Matcher m = java.util.regex.Pattern.compile("Chrome/([0-9.]+)").matcher(web.getSettings().getUserAgentString());
                if (m.find()) wvVersion = m.group(1);
            }
            java.util.regex.Matcher m2 = java.util.regex.Pattern.compile("^(\\d+)").matcher(wvVersion);
            if (m2.find()) wvMajor = Integer.parseInt(m2.group(1));
        } catch (Exception ignored) {}
    }

    /** Once per install (per WebView major): the site needs a reasonably modern WebView. */
    void maybeWebViewHint() {
        if (isFinishing() || !resumed || wvMajor <= 0 || wvMajor >= 111) return;
        SharedPreferences sp = getSharedPreferences("app", Context.MODE_PRIVATE);
        if (sp.getBoolean("wvHintShown", false)) return;
        sp.edit().putBoolean("wvHintShown", true).apply();
        final String pkg = wvPackage.isEmpty() ? "com.google.android.webview" : wvPackage;
        try {
            new VvDialog(this)
                .title(getString(R.string.wv_title))
                .chip(wvVersion.isEmpty() ? null : "WebView " + wvMajor)
                .message(getString(R.string.wv_msg, wvVersion))
                .primary(getString(R.string.wv_update), () -> {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
                    catch (Exception e) { try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + pkg)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) {} }
                })
                .secondary(getString(R.string.wv_later), null)
                .show();
        } catch (Exception ignored) {}
    }

    /** window.alert / confirm / prompt of the page in the app's own dialog style (the WebView's stock dialog is never shown). Every JsResult is answered exactly once. */
    boolean jsDialog(String url, String msg, int kind, String promptDefault, android.webkit.JsResult res) {   // kind: 0 alert, 1 confirm, 2 prompt
        if (isFinishing() || isDestroyed()) { res.cancel(); return true; }
        final boolean[] done = {false};
        String host = "";
        try { host = Uri.parse(url).getHost(); } catch (Exception ignored) {}
        VvDialog d = new VvDialog(this).title(host == null || host.isEmpty() ? getString(R.string.app_name) : host)
            .message(msg == null ? "" : msg).cancelable(true);
        if (kind == 2) {
            android.webkit.JsPromptResult pr = (android.webkit.JsPromptResult) res;
            d.input("", promptDefault, t -> { if (!done[0]) { done[0] = true; pr.confirm(t); } }).primary(getString(R.string.js_ok), null);
        } else d.primary(getString(R.string.js_ok), () -> { if (!done[0]) { done[0] = true; res.confirm(); } });
        if (kind >= 1) d.secondary(getString(R.string.js_cancel), () -> { if (!done[0]) { done[0] = true; res.cancel(); } });
        d.onDismiss(() -> {
            if (done[0]) return;
            done[0] = true;
            if (kind == 0) res.confirm(); else res.cancel();   // dismissing = OK for alert, Cancel for confirm / prompt
        });
        d.show();
        return true;
    }

    /** IME height (px) -> page: CSS var --vv-kb / --kb, class vv-kb-open and event vvvion-app-keyboard {height, visible, open} (CSS px). Coalesced, only on change. */
    void postKeyboard(int px) {
        kbPx = px;
        ui.removeCallbacks(kbR);
        ui.postDelayed(kbR, 30);
    }

    void sendKeyboard() {
        if (web == null) return;
        int h = Math.round(kbPx / getResources().getDisplayMetrics().density);
        if (h == kbSent) return;
        if (!trustedPage) return;
        kbSent = h;
        web.evaluateJavascript("window.__vvKb&&window.__vvKb(" + h + "," + (h > 0) + ")", null);
    }

    String keyboardJson() { return "{\"height\":" + Math.round(kbPx / getResources().getDisplayMetrics().density) + ",\"visible\":" + (kbPx > 0) + "}"; }

    boolean shareText(String title, String text, String url) {
        StringBuilder b = new StringBuilder();
        if (text != null && !text.isEmpty()) b.append(text);
        if (url != null && !url.isEmpty() && (text == null || !text.contains(url))) { if (b.length() > 0) b.append('\n'); b.append(url); }
        if (b.length() == 0 || !resumed) return false;
        if (b.length() > 100000) b.setLength(100000);
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, b.toString());
        if (title != null && !title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, AppNotifier.clip(title, 200));
        try { startActivity(Intent.createChooser(send, title != null && !title.isEmpty() ? AppNotifier.clip(title, 60) : null)); return true; }
        catch (Exception e) { return false; }
    }

    void copyText(String text) {
        try {
            android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            cm.setPrimaryClip(android.content.ClipData.newPlainText("vvvion", text == null ? "" : text));
        } catch (Exception ignored) {}
    }

    // ---------- bridge helpers ----------
    static boolean isForeground() { MainActivity a = inst; return a != null && a.resumed; }
    static boolean hasWeb() { MainActivity a = inst; return a != null && a.web != null; }

    static boolean isTrusted(String url) {
        if (url == null) return false;
        return NativeUrlPolicy.isTrusted(url);
    }

    /** Only vvvion.space URLs (or paths on it) may be opened inside the app; anything else falls back to the home page. */
    static Uri safeUrl(Uri u) {
        if (u == null) return Uri.parse(HOME);
        if (u.getScheme() == null && u.getHost() == null) {
            String p = u.toString();
            return Uri.parse(HOME + (p.startsWith("/") ? p.substring(1) : p));
        }
        return isTrusted(u.toString()) ? u : Uri.parse(HOME);
    }

    void loadBridgeJs() {
        try (InputStream in = getAssets().open("app/vv-bridge.js")) { bridgeJs = Updater.read(in); } catch (IOException ignored) {}
    }

    void inject(WebView v) {
        if (bridgeJs == null || !trustedPage || !isTrusted(v.getUrl())) return;
        // evaluateJavascript executes in the main frame. The capability is never a window property.
        String script = "(function(cap){if(window.top!==window||location.origin!=='https://vvvion.space')return;var raw=window.VvvionNative;var nativeApi={};"
            + "nativeApi.pullToRefresh=function(){return raw.pullToRefresh.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.backDefault=function(){return raw.backDefault.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.perf=function(){return raw.perf.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.pushAvailable=function(){return raw.pushAvailable.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.pushToken=function(){return raw.pushToken.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.notificationsEnabled=function(){return raw.notificationsEnabled.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.requestNotificationPermission=function(){return raw.requestNotificationPermission.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.openNotificationSettings=function(){return raw.openNotificationSettings.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.notify=function(){return raw.notify.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.cancelNotification=function(){return raw.cancelNotification.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.mediaState=function(){return raw.mediaState.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.haptic=function(){return raw.haptic.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.onTheme=function(){return raw.onTheme.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.share=function(){return raw.share.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.copy=function(){return raw.copy.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.badge=function(){return raw.badge.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.debugLog=function(){return raw.debugLog.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.webViewVersion=function(){return raw.webViewVersion.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.isTablet=function(){return raw.isTablet.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.screen=function(){return raw.screen.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.keyboard=function(){return raw.keyboard.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.info=function(){return raw.info.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.plTrack=function(){return raw.plTrack.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.plQueue=function(){return raw.plQueue.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.plPlay=function(){return raw.plPlay.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.plPause=function(){return raw.plPause.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.plNext=function(){return raw.plNext.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.plPrev=function(){return raw.plPrev.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.plSeek=function(){return raw.plSeek.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.plStop=function(){return raw.plStop.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.plRepeat=function(){return raw.plRepeat.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.plShuffle=function(){return raw.plShuffle.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.plMeta=function(){return raw.plMeta.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.setWidgetCity=function(){return raw.setWidgetCity.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.plState=function(){return raw.plState.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.openExternal=function(){return raw.openExternal.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.dlBegin=function(){return raw.dlBegin.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.dlChunk=function(){return raw.dlChunk.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.dlEnd=function(){return raw.dlEnd.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};nativeApi.dlFail=function(){return raw.dlFail.apply(raw,[cap].concat(Array.prototype.slice.call(arguments)));};" + bridgeJs.replace("var N = window.VvvionNative;", "var N = nativeApi;")
            + "})(" + org.json.JSONObject.quote(bridgeCapability.value()) + ");";
        v.evaluateJavascript(script, null);
    }

    /** Opens a link (notification tap, VIEW intent) without reloading the SPA, so music/streams keep running. */
    void navigateTo(Uri target) {
        final String url = target.toString();
        if (web.getUrl() == null || !isTrusted(web.getUrl()) || loaderVisible || mainFailed || offlineVisible) { hideOfflineScreen(); mainFailed = false; web.loadUrl(url); return; }
        final String q = org.json.JSONObject.quote(url);
        String js = "(function(){try{var u=new URL(" + q + ");if(u.origin!==location.origin)return 'no';var p=u.pathname+u.search+u.hash;"
            + "if(window.__vvvionNavigate){window.__vvvionNavigate(p);return 'ok'}"
            + "if(u.pathname+u.search!==location.pathname+location.search){history.pushState(history.state,'',p);"
            + "window.dispatchEvent(new PopStateEvent('popstate',{state:history.state}))}return 'ok'}catch(e){return 'no'}})()";
        web.evaluateJavascript(js, r -> {
            if (!"\"ok\"".equals(r)) { web.loadUrl(url); return; }
            // verify the router really followed; if not, fall back to a normal load
            ui.postDelayed(() -> web.evaluateJavascript("(location.pathname+location.search)", cur -> {
                String want = target.getEncodedPath() + (target.getEncodedQuery() != null ? "?" + target.getEncodedQuery() : "");
                String have = cur == null ? "" : cur.replace("\"", "");
                if (!want.isEmpty() && !have.equals(want)) web.loadUrl(url);
            }), 1200);
        });
    }

    /** From the media service / lock screen: forwarded to the injected script. */
    static void mediaCmd(String cmd, long arg) {
        final MainActivity a = inst;
        if (a == null || a.web == null) return;
        a.ui.post(() -> {
            if (a.web == null) return;
            a.web.evaluateJavascript("window.__vvMedia&&window.__vvMedia.cmd(" + org.json.JSONObject.quote(cmd) + "," + arg + ")", null);
        });
    }

    /** Service started/stopped: keep the WebView running while the service lives, pause it again once it is gone in background. */
    static void onMediaServiceState() {
        final MainActivity a = inst;
        if (a == null) return;
        a.ui.post(() -> {
            if (a.web == null) return;
            if (MediaPlaybackService.active()) { if (a.webPaused) { a.web.onResume(); a.webPaused = false; } }
            else if (!a.resumed && !a.webPaused) { a.web.onPause(); a.webPaused = true; }
        });
    }

    static void emitToPage(String event, String jsObjectLiteral) {
        final MainActivity a = inst;
        if (a == null || a.web == null) return;
        a.ui.post(() -> { if (a.web != null && trustedPage) a.web.evaluateJavascript("window.__vvEmit&&window.__vvEmit('" + event + "'," + jsObjectLiteral + ")", null); });
    }

    void emitNotificationState() {
        emitToPage("vvvion-app-notifications", "{enabled:" + AppNotifier.canNotify(this) + "}");
    }

    /** Android 13+ runtime permission. fromWeb=true: the site asked (always allowed); false: automatic, at most once. */
    void askNotifications(boolean fromWeb) {
        if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) { emitNotificationState(); return; }
        SharedPreferences sp = getSharedPreferences("app", Context.MODE_PRIVATE);
        if (!fromWeb && sp.getBoolean("notifAsked", false)) return;
        sp.edit().putBoolean("notifAsked", true).apply();
        if (resumed) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 3);
    }

    /** First time music plays: ask for the notification permission so the player controls can be shown. */
    void onMusicStarted() { askNotifications(false); }
    static void musicStarted() { final MainActivity a = inst; if (a != null) a.ui.post(a::onMusicStarted); }

    // ---------- smooth start: keep the system splash until the page is ready ----------
    void holdSplash() {
        final View content = findViewById(android.R.id.content);
        content.getViewTreeObserver().addOnPreDrawListener(new ViewTreeObserver.OnPreDrawListener() {
            @Override public boolean onPreDraw() {
                if (splashHeld) return false;
                ViewTreeObserver o = content.getViewTreeObserver();
                if (o.isAlive()) o.removeOnPreDrawListener(this);
                return true;
            }
        });
        ui.postDelayed(splashTimeout, SPLASH_MAX_MS);
        ui.postDelayed(() -> releaseSplash(false), 120);   // beta2: let the system splash go almost at once, the branded loader takes over
    }

    void onSplashTimeout() {
        if (!splashHeld) return;
        releaseSplash(web != null && web.getProgress() >= 70 && !mainFailed && !offlineVisible);
    }

    /** @param pageReady true: the page is drawable, hide the native loader and fade the WebView in; false: show the native loader. */
    void releaseSplash(boolean pageReady) {
        if (!splashHeld) return;
        splashHeld = false;
        ui.removeCallbacks(splashTimeout);
        if (pageReady) {
            hideLoaderNow();
            fadeWeb(0f, 200);
        } else loaderShownAt = System.currentTimeMillis();
        applyBarColors();
        root.invalidate();
    }

    /** Hints for the web app (window.VvvionApp.perf()). Computed once. */
    static String perfCache;
    String perfJson() {
        if (perfCache != null) return perfCache;
        boolean low = false; long ramMb = 0; int hz = 60;
        try {
            ActivityManager am = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo(); am.getMemoryInfo(mi);
            ramMb = mi.totalMem / (1024 * 1024);
            low = am.isLowRamDevice() || ramMb <= 3300 || Build.VERSION.SDK_INT <= 27;
        } catch (Exception ignored) {}
        try { hz = Math.round(getWindowManager().getDefaultDisplay().getRefreshRate()); } catch (Exception ignored) {}
        int cores = Runtime.getRuntime().availableProcessors();
        boolean reduce = false;
        try {
            reduce = Settings.Global.getFloat(getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f;
        } catch (Exception ignored) {}
        try {
            perfCache = new org.json.JSONObject().put("lowEnd", low).put("reduceMotion", reduce).put("hz", hz)
                .put("ramMb", ramMb).put("cores", cores).put("sdk", Build.VERSION.SDK_INT).toString();
        } catch (Exception e) { perfCache = "{}"; }
        return perfCache;
    }

    boolean animationsOn() {
        try { return Settings.Global.getFloat(getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f; } catch (Exception e) { return true; }
    }

    void fadeWeb(float from, long ms) {
        if (web == null || !animationsOn()) { if (web != null) web.setAlpha(1f); return; }
        web.animate().cancel();
        web.setAlpha(from);
        web.animate().alpha(1f).setDuration(ms).setInterpolator(new DecelerateInterpolator()).withEndAction(() -> web.setAlpha(1f)).start();
    }

    void hideLoaderNow() {
        loaderVisible = false; applyBarColors();
        ui.removeCallbacks(loaderTimeout);
        if (loaderWeb != null) { loaderWeb.animate().cancel(); loaderWeb.setVisibility(View.GONE); loaderWeb.onPause(); }
    }

    // ---------- thin top progress bar (only for navigations slower than 300 ms) ----------
    void navStart() {
        if (splashHeld || loaderVisible || offlineVisible) return;
        navActive = true;
        ui.removeCallbacks(showBarR);
        ui.postDelayed(showBarR, 300);
    }

    void showBar() {
        if (!navActive || progressBar == null) return;
        progressBar.animate().cancel();
        progressBar.setScaleX(Math.max(0.05f, web.getProgress() / 100f));
        progressBar.setAlpha(1f);
        progressBar.setVisibility(View.VISIBLE);
        barShown = true;
    }

    void onProgress(int p) {
        if (splashHeld && p >= 70 && loaderVisible && !mainFailed) web.evaluateJavascript(READY_JS, null);
        if (!barShown) return;
        float sx = Math.max(0.05f, p / 100f);
        if (animationsOn()) progressBar.animate().scaleX(sx).setDuration(120).start(); else progressBar.setScaleX(sx);
    }

    void navEnd() {
        navActive = false;
        ui.removeCallbacks(showBarR);
        if (!barShown || progressBar == null) return;
        barShown = false;
        progressBar.animate().cancel();
        if (animationsOn()) {
            progressBar.animate().scaleX(1f).setDuration(120).withEndAction(() ->
                progressBar.animate().alpha(0f).setDuration(180).withEndAction(() -> progressBar.setVisibility(View.GONE)).start()).start();
        } else progressBar.setVisibility(View.GONE);
    }

    // ---------- offline screen ----------
    boolean isOnline() {
        try {
            ConnectivityManager cm = getSystemService(ConnectivityManager.class);
            Network n = cm.getActiveNetwork();
            android.net.NetworkCapabilities nc = n == null ? null : cm.getNetworkCapabilities(n);
            return nc != null && nc.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Exception e) { return true; }
    }

    boolean isNetworkError(int code) {
        switch (code) {
            case WebViewClient.ERROR_HOST_LOOKUP: case WebViewClient.ERROR_CONNECT: case WebViewClient.ERROR_IO: case WebViewClient.ERROR_TIMEOUT:
                return true;
            case WebViewClient.ERROR_UNKNOWN: return !isOnline();
            default: return !isOnline() && code != WebViewClient.ERROR_UNSUPPORTED_SCHEME;
        }
    }

    void showOfflineScreen(String url) {
        failedUrl = url; mainFailed = true;
        navEnd(); ptr.done();
        releaseSplash(false);
        hideLoaderNow();
        if (!offlineVisible) {
            offlineVisible = true; applyBarColors();
            offline.animate().cancel();
            offline.setVisibility(View.VISIBLE);
            if (animationsOn()) { offline.setAlpha(0f); offline.animate().alpha(1f).setDuration(160).start(); } else offline.setAlpha(1f);
        }
    }

    void hideOfflineScreen() {
        if (!offlineVisible) return;
        offlineVisible = false; applyBarColors();
        offline.animate().cancel();
        offline.setVisibility(View.GONE);
    }

    void registerNet() {
        try {
            ConnectivityManager cm = getSystemService(ConnectivityManager.class);
            netCb = new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network n) { ui.post(MainActivity.this::onNetBack); }
            };
            cm.registerDefaultNetworkCallback(netCb);
        } catch (Exception ignored) { netCb = null; }
    }

    /** Connectivity is back: if the offline screen is up, retry once (rate limited). Music keeps playing meanwhile. */
    void onNetBack() {
        if (!offlineVisible) return;
        long now = SystemClock.uptimeMillis();
        if (now - lastAutoRetry < 1500) return;
        lastAutoRetry = now;
        retryLoad();
    }

    // ---------- downloads of blob: URLs the page cannot hand to DownloadManager ----------
    void runBlobSave(String url, String name, String mime) {
        ui.post(() -> {
            if (web == null) return;
            web.evaluateJavascript("window.__vvSaveBlob&&window.__vvSaveBlob(" + org.json.JSONObject.quote(url) + ","
                + org.json.JSONObject.quote(name == null ? "" : name) + "," + org.json.JSONObject.quote(mime == null ? "" : mime) + ")", null);
        });
    }

    // ---------- haptics (VvvionApp.haptic) ----------
    void haptic(String type) {
        long now = SystemClock.uptimeMillis();
        if (now - lastHaptic < 40) return;
        lastHaptic = now;
        final String t = type == null ? "light" : type;
        ui.post(() -> {
            if (web == null) return;
            int sdk = Build.VERSION.SDK_INT;
            switch (t) {
                case "medium": web.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY); break;
                case "heavy": web.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS); break;
                case "success": web.performHapticFeedback(sdk >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.VIRTUAL_KEY); break;
                case "error":
                    if (sdk >= 30) web.performHapticFeedback(HapticFeedbackConstants.REJECT);
                    else { web.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS); ui.postDelayed(() -> { if (web != null) web.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS); }, 110); }
                    break;
                case "warning":
                    web.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                    ui.postDelayed(() -> { if (web != null) web.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY); }, 90);
                    break;
                case "selection": web.performHapticFeedback(sdk >= 34 ? HapticFeedbackConstants.SEGMENT_TICK : HapticFeedbackConstants.CLOCK_TICK); break;
                default: web.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);   // light
            }
        });
    }
}
