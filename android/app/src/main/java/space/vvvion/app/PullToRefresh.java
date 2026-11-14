package space.vvvion.app;

import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ProgressBar;

/**
 * Pull-to-refresh without AndroidX. The page reports, on every touchstart, whether the touched
 * element and all its scrollable ancestors (and the window) are scrolled to the top. Only then
 * a downward drag shows the spinner, and releasing past the threshold reloads the page.
 */
class PullToRefresh {
    /** One passive touchstart per page. No getComputedStyle (it forced a style recalc on EVERY touch, which at low FPS delayed the first
     *  scroll frames): "scrollTop > 0" on the ancestors is all that matters. Reports the result on every touch (native resets it on ACTION_DOWN, so a stale 'true' can never leak into the next touch). */
    static final String JS = "(function(){if(window.__vvPtr)return;window.__vvPtr=1;"
        + "document.addEventListener('touchstart',function(e){var ok=(window.scrollY||document.documentElement.scrollTop||0)<=0;"
        + "for(var el=e.target;ok&&el&&el.nodeType===1;el=el.parentElement){if(el.scrollTop>0)ok=false;}"
        + "if(ok&&document.querySelector('dialog[open],[aria-modal=true]'))ok=false;"
        + "try{VVPtr.setTop(ok)}catch(_){}},{passive:true,capture:true});})()";

    final WebView web;
    final FrameLayout spinnerBox;
    final float density;
    volatile boolean atTop = false;
    volatile boolean enabled = false;   // the web app can switch native pull-to-refresh off (VvvionApp.pullToRefresh(false)) if it ships its own
    float downX, downY; boolean pulling = false, tracking = false;

    PullToRefresh(FrameLayout root, WebView web) {
        this.web = web;
        density = web.getResources().getDisplayMetrics().density;
        ProgressBar pb = new ProgressBar(web.getContext());
        pb.setIndeterminate(true);
        pb.setIndeterminateTintList(ColorStateList.valueOf(Color.parseColor("#b9a6ff")));
        spinnerBox = new FrameLayout(web.getContext());
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL); bg.setColor(Color.parseColor("#0c0c0e"));
        bg.setStroke((int) (1.5f * density), Color.parseColor("#6b4fd8"));
        spinnerBox.setBackground(bg);
        spinnerBox.setElevation(6 * density);
        int pad = (int) (8 * density);
        spinnerBox.setPadding(pad, pad, pad, pad);
        spinnerBox.addView(pb, new FrameLayout.LayoutParams((int) (28 * density), (int) (28 * density)));
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        root.addView(spinnerBox, lp);
        reset();
        web.addJavascriptInterface(this, "VVPtr");
        web.setOnTouchListener(this::onTouch);
    }

    @JavascriptInterface public void setTop(boolean ok) { atTop = ok; }
    @JavascriptInterface public void setEnabled(boolean on) { enabled = on; }

    float threshold() { return 90 * density; }

    void reset() {
        spinnerBox.setVisibility(View.GONE);
        spinnerBox.setTranslationY(-60 * density);
        spinnerBox.setAlpha(0f);
    }

    boolean onTouch(View v, MotionEvent e) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downX = e.getX(); downY = e.getY(); pulling = false; tracking = enabled; if (enabled) atTop = false;  // 'false' until the page says it is at the top for THIS touch
                break;
            case MotionEvent.ACTION_POINTER_DOWN:
                tracking = false; if (pulling) cancel();
                break;
            case MotionEvent.ACTION_MOVE:
                if (!tracking) break;
                float dy = e.getY() - downY, dx = Math.abs(e.getX() - downX);
                if (!pulling) {
                    if (dy > 18 * density && dy > dx * 2.2f && atTop && web.getScrollY() == 0) pulling = true;   // deliberate, mostly vertical drag only
                    else if (dy < -6 * density || dx > 16 * density) tracking = false;
                }
                if (pulling) {
                    float d = Math.min(dy * 0.5f, threshold() * 1.3f);
                    spinnerBox.setVisibility(View.VISIBLE);
                    spinnerBox.setTranslationY(d - 20 * density);
                    spinnerBox.setAlpha(Math.min(1f, d / threshold()));
                    spinnerBox.setRotation(d * 2);
                }
                break;
            case MotionEvent.ACTION_UP:
                // a refresh needs distance AND a human-speed drag (>= 220 ms): a low-FPS jump of one big touch delta must not reload the page
                if (pulling && (e.getY() - downY) * 0.5f >= threshold() && e.getEventTime() - e.getDownTime() >= 220) refresh(); else if (pulling) cancel();
                pulling = false; tracking = false;
                break;
            case MotionEvent.ACTION_CANCEL:
                if (pulling) cancel(); pulling = false; tracking = false;
                break;
        }
        return false; // never consume: the page keeps its own touch handling
    }

    void cancel() { spinnerBox.animate().alpha(0f).translationY(-60 * density).setDuration(180).withEndAction(this::reset).start(); }

    void refresh() {
        spinnerBox.animate().translationY(24 * density).alpha(1f).setDuration(150).start();
        web.reload();
    }

    /** Called from onPageFinished / onReceivedError. */
    void done() { if (spinnerBox.getVisibility() == View.VISIBLE && !pulling) cancel(); }
}
