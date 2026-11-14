package space.vvvion.app;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.Dialog;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.provider.Settings;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;

/**
 * The app's one dialog component (update, WebView hint, JS alert/confirm/prompt) in the site's style:
 * a rounded card over a dim scrim that slides up and fades in (220 ms; plain fade on low-end devices, none when animations are off).
 * Colours are the site tokens (--elev, --line, --fg, --muted, --accent, --accent-fg); the light variant follows the theme saved by the bridge.
 */
final class VvDialog {
    // dark tokens
    static final int D_CARD = 0xFF141417, D_LINE = 0xFF2E2E34, D_FG = 0xFFF4F2EE, D_MUTED = 0xFFB0ADA6, D_FAINT = 0xFF8A877F, D_ACC = 0xFFC4B5E8, D_ACCFG = 0xFF1B1526;
    // light tokens
    static final int L_CARD = 0xFFFFFCF8, L_LINE = 0xFFDDD6CC, L_FG = 0xFF1C1B19, L_MUTED = 0xFF5C5852, L_FAINT = 0xFF7D7870, L_ACC = 0xFF534477, L_ACCFG = 0xFFF7F4FF;

    final Activity a;
    final float d;
    final boolean light;
    final int card, line, fg, muted, faint, acc, accFg;
    String title, chip, sub, message, primary, secondary, tertiary, inputHint, inputValue;
    final List<String> lines = new ArrayList<>();
    boolean cancelable = true, withInput = false;
    Runnable onPrimary, onSecondary, onTertiary, onDismiss;
    /** Receives the typed text when the primary button of an input dialog is pressed. */
    interface Text { void got(String s); }
    Text onInput;
    Dialog dlg;
    /** The dialog currently on screen (null if none): callers that are not urgent (update check) wait for it. */
    static VvDialog active;
    EditText input;
    boolean closing = false, acted = false;

    VvDialog(Activity a) {
        this.a = a;
        d = a.getResources().getDisplayMetrics().density;
        light = a.getSharedPreferences("app", Context.MODE_PRIVATE).getBoolean("themeLight", false);
        card = light ? L_CARD : D_CARD; line = light ? L_LINE : D_LINE; fg = light ? L_FG : D_FG; muted = light ? L_MUTED : D_MUTED;
        faint = light ? L_FAINT : D_FAINT; acc = light ? L_ACC : D_ACC; accFg = light ? L_ACCFG : D_ACCFG;
    }

    VvDialog title(String s) { title = s; return this; }
    VvDialog chip(String s) { chip = s; return this; }
    VvDialog sub(String s) { sub = s; return this; }
    VvDialog message(String s) { message = s; return this; }
    VvDialog lines(List<String> l) { if (l != null) lines.addAll(l); return this; }
    VvDialog primary(String s, Runnable r) { primary = s; onPrimary = r; return this; }
    VvDialog secondary(String s, Runnable r) { secondary = s; onSecondary = r; return this; }
    VvDialog tertiary(String s, Runnable r) { tertiary = s; onTertiary = r; return this; }
    VvDialog cancelable(boolean b) { cancelable = b; return this; }
    VvDialog onDismiss(Runnable r) { onDismiss = r; return this; }
    VvDialog input(String hint, String value, Text t) { withInput = true; inputHint = hint; inputValue = value; onInput = t; return this; }

    int dp(float v) { return Math.round(v * d); }

    static Typeface medium() { return Typeface.create("sans-serif-medium", Typeface.NORMAL); }

    boolean animationsOff() {
        try { return Settings.Global.getFloat(a.getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f; } catch (Exception e) { return false; }
    }
    boolean lowEnd() {
        try { return ((ActivityManager) a.getSystemService(Context.ACTIVITY_SERVICE)).isLowRamDevice(); } catch (Exception e) { return false; }
    }

    TextView text(String s, float sp, int color, boolean med) {
        TextView t = new TextView(a);
        t.setText(s); t.setTextColor(color); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTypeface(med ? medium() : Typeface.SANS_SERIF);
        t.setIncludeFontPadding(false);
        return t;
    }

    GradientDrawable round(int color, float r) { GradientDrawable g = new GradientDrawable(); g.setColor(color); g.setCornerRadius(r * d); return g; }

    View button(String label, boolean filled, float sp, int color, Runnable r) {
        TextView b = text(label, sp, filled ? accFg : color, true);
        b.setGravity(Gravity.CENTER);
        b.setMinHeight(dp(48));
        b.setPadding(dp(12), dp(10), dp(12), dp(10));
        b.setLineSpacing(0, 1.1f);
        b.setClickable(true); b.setFocusable(true);
        int ripple = filled ? (light ? 0x33FFFFFF : 0x2A1B1526) : (light ? 0x1A1C1B19 : 0x1FF4F2EE);
        b.setBackground(new RippleDrawable(ColorStateList.valueOf(ripple), filled ? round(acc, 16) : null, round(Color.WHITE, 16)));
        b.setOnClickListener(v -> { acted = true; close(r); });
        return b;
    }

    /** ScrollView that never grows beyond maxPx. */
    static final class MaxScroll extends ScrollView {
        final int max;
        MaxScroll(Context c, int max) { super(c); this.max = max; setOverScrollMode(OVER_SCROLL_NEVER); setVerticalScrollBarEnabled(false); }
        @Override protected void onMeasure(int w, int h) { super.onMeasure(w, MeasureSpec.makeMeasureSpec(max, MeasureSpec.AT_MOST)); }
    }

    View build() {
        LinearLayout col = new LinearLayout(a);
        col.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable bg = round(card, 20); bg.setStroke(Math.max(1, dp(1)), line);
        col.setBackground(bg);
        col.setPadding(dp(22), 0, dp(22), dp(12));
        col.setClickable(true);   // taps on the card must not reach the scrim

        View handle = new View(a);
        handle.setBackground(round(line, 2));
        LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(dp(36), dp(4));
        hp.gravity = Gravity.CENTER_HORIZONTAL; hp.topMargin = dp(10); hp.bottomMargin = dp(14);
        col.addView(handle, hp);

        LinearLayout head = new LinearLayout(a);
        head.setOrientation(LinearLayout.HORIZONTAL); head.setGravity(Gravity.CENTER_VERTICAL);
        TextView t = text(title == null ? "" : title, 21, fg, true);
        t.setLineSpacing(0, 1.1f);
        head.addView(t, new LinearLayout.LayoutParams(0, -2, 1f));
        if (chip != null && !chip.isEmpty()) {
            TextView c = text(chip, 12.5f, acc, true);
            c.setPadding(dp(10), dp(5), dp(10), dp(5));
            c.setBackground(round((acc & 0x00FFFFFF) | 0x2B000000, 100));
            LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(-2, -2); cp.leftMargin = dp(10);
            head.addView(c, cp);
        }
        col.addView(head, new LinearLayout.LayoutParams(-1, -2));

        if (sub != null && !sub.isEmpty()) {
            TextView s = text(sub, 13.5f, muted, false);
            LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-2, -2); sp.topMargin = dp(6);
            col.addView(s, sp);
        }

        boolean hasList = !lines.isEmpty(), hasMsg = message != null && !message.isEmpty();
        if (hasList || hasMsg) {
            LinearLayout body = new LinearLayout(a);
            body.setOrientation(LinearLayout.VERTICAL);
            if (hasMsg) {
                TextView m = text(message, 15f, hasList ? muted : fg, false);
                m.setLineSpacing(0, 1.25f);
                body.addView(m, new LinearLayout.LayoutParams(-1, -2));
            }
            for (String l : lines) {
                LinearLayout row = new LinearLayout(a);
                row.setOrientation(LinearLayout.HORIZONTAL);
                TextView dot = text("•", 15f, acc, true);
                LinearLayout.LayoutParams dp0 = new LinearLayout.LayoutParams(dp(18), -2);
                row.addView(dot, dp0);
                TextView tx = text(l, 14.5f, fg, false);
                tx.setLineSpacing(0, 1.2f);
                row.addView(tx, new LinearLayout.LayoutParams(0, -2, 1f));
                LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(-1, -2);
                rp.topMargin = dp(body.getChildCount() == 0 ? 0 : 8);
                body.addView(row, rp);
            }
            MaxScroll sc = new MaxScroll(a, dp(hasList ? 164 : 220));
            sc.addView(body, new FrameLayout.LayoutParams(-1, -2));
            LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-1, -2); sp.topMargin = dp(16);
            col.addView(sc, sp);
        }

        if (withInput) {
            input = new EditText(a);
            input.setText(inputValue == null ? "" : inputValue); input.setHint(inputHint == null ? "" : inputHint);
            input.setTextColor(fg); input.setHintTextColor(faint); input.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f);
            input.setSingleLine(true); input.setInputType(InputType.TYPE_CLASS_TEXT); input.setImeOptions(EditorInfo.IME_ACTION_DONE);
            input.setPadding(dp(14), dp(10), dp(14), dp(10)); input.setMinHeight(dp(48));
            GradientDrawable ib = round(Color.TRANSPARENT, 14); ib.setStroke(Math.max(1, dp(1)), line);
            input.setBackground(ib);
            input.setOnEditorActionListener((v, id, e) -> { if (id == EditorInfo.IME_ACTION_DONE) { acted = true; close(() -> { if (onInput != null) onInput.got(input.getText().toString()); }); return true; } return false; });
            LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(-1, -2); ip.topMargin = dp(14);
            col.addView(input, ip);
        }

        if (primary != null) {
            Runnable r = onPrimary;
            View b = button(primary, true, 15.5f, accFg, withInput ? () -> { if (onInput != null) onInput.got(input.getText().toString()); } : r);
            LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-1, dp(50)); bp.topMargin = dp(20);
            col.addView(b, bp);
        }
        boolean two = secondary != null && tertiary != null;
        if (secondary != null || tertiary != null) {
            LinearLayout row = new LinearLayout(a);
            row.setOrientation(LinearLayout.HORIZONTAL);
            if (secondary != null) row.addView(button(secondary, false, 14.5f, muted, onSecondary), new LinearLayout.LayoutParams(two ? 0 : -1, -2, two ? 1f : 0f));
            if (tertiary != null) row.addView(button(tertiary, false, 13f, faint, onTertiary), new LinearLayout.LayoutParams(two ? 0 : -1, -2, two ? 1.25f : 0f));
            LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(-1, -2); rp.topMargin = dp(4);
            col.addView(row, rp);
        }
        return col;
    }

    void show() {
        if (a.isFinishing() || a.isDestroyed()) { if (onDismiss != null) onDismiss.run(); return; }
        try { showImpl(); } catch (Throwable t) { try { if (dlg != null) dlg.dismiss(); } catch (Exception ignored) {} fireDismiss(); }
    }

    void showImpl() {
        dlg = new Dialog(a, android.R.style.Theme_DeviceDefault_Dialog_NoActionBar);
        Window w = dlg.getWindow();
        w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        w.setWindowAnimations(0);
        w.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        w.setDimAmount(0f);
        w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        w.setGravity(Gravity.BOTTOM);
        w.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        final View cardView = build();
        FrameLayout root = new FrameLayout(a);
        root.setClipChildren(false); root.setClipToPadding(false);
        int maxW = Math.round(Math.min(a.getResources().getDisplayMetrics().widthPixels - dp(24), dp(440)));
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(maxW, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        root.addView(cardView, lp);
        root.setPadding(0, dp(12), 0, dp(12));
        root.setOnApplyWindowInsetsListener((v, ins) -> { v.setPadding(0, dp(12), 0, dp(12) + ins.getSystemWindowInsetBottom()); return ins; });
        // a tap on the dimmed area dismisses (unless the dialog is mandatory)
        root.setOnClickListener(v -> { if (cancelable) { close(null); } });
        dlg.setContentView(root);
        dlg.setCanceledOnTouchOutside(false);   // handled by the root click (the window is full-width)
        dlg.setCancelable(cancelable);
        dlg.setOnCancelListener(x -> { if (!acted) fireDismiss(); });
        dlg.setOnDismissListener(x -> { if (!acted) fireDismiss(); });
        dlg.show();
        active = this;
        animateIn(cardView);
    }

    boolean dismissFired = false;
    void fireDismiss() { if (dismissFired) return; dismissFired = true; if (active == this) active = null; if (onDismiss != null) onDismiss.run(); }

    void animateIn(View card) {
        final WindowManager.LayoutParams p = dlg.getWindow().getAttributes();
        final float dim = 0.6f;
        if (animationsOff()) { p.dimAmount = dim; dlg.getWindow().setAttributes(p); return; }
        boolean fadeOnly = lowEnd();
        card.setAlpha(0f); card.setTranslationY(fadeOnly ? 0 : dp(40));
        long dur = fadeOnly ? 120 : 220;
        card.animate().alpha(1f).translationY(0).setDuration(dur).setInterpolator(new DecelerateInterpolator(1.6f)).start();
        android.animation.ValueAnimator va = android.animation.ValueAnimator.ofFloat(0f, dim);
        va.setDuration(dur);
        va.addUpdateListener(an -> { try { p.dimAmount = (float) an.getAnimatedValue(); dlg.getWindow().setAttributes(p); } catch (Exception ignored) {} });
        va.start();
    }

    /** Animates out, then runs `after` (the chosen action) once the card is gone. */
    void close(Runnable after) {
        if (closing) return;
        closing = true;
        final Runnable fin = () -> {
            try { dlg.dismiss(); } catch (Exception ignored) {}
            if (after != null) after.run();
            if (active == this) active = null;
            if (after == null) fireDismiss(); else if (!dismissFired) { dismissFired = true; if (onDismiss != null) onDismiss.run(); }
        };
        final boolean[] ran = {false};
        final Runnable once = () -> { if (!ran[0]) { ran[0] = true; fin.run(); } };
        View c = dlg.getWindow().getDecorView();
        if (animationsOff()) { once.run(); return; }
        final WindowManager.LayoutParams p = dlg.getWindow().getAttributes();
        final float from = p.dimAmount;
        android.animation.ValueAnimator va = android.animation.ValueAnimator.ofFloat(from, 0f);
        va.setDuration(140);
        va.addUpdateListener(an -> { try { p.dimAmount = (float) an.getAnimatedValue(); dlg.getWindow().setAttributes(p); } catch (Exception ignored) {} });
        va.start();
        c.animate().alpha(0f).translationY(lowEnd() ? 0 : dp(24)).setDuration(140).withEndAction(once).start();
        c.postDelayed(once, 260);   // safety net if the end action never fires (view detached)
    }

    void dismissNow() { try { if (dlg != null) dlg.dismiss(); } catch (Exception ignored) {} fireDismiss(); }

    /** True only while a dialog is really on screen (a stale reference never blocks later dialogs). */
    static boolean showing() { VvDialog v = active; return v != null && v.dlg != null && v.dlg.isShowing(); }

    /** Activity is going away: close the dialog and answer whatever it was waiting for (JsResult, busy flags). */
    static void dismissActive() { VvDialog v = active; active = null; if (v != null) v.dismissNow(); }
}
