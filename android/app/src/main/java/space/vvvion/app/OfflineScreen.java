package space.vvvion.app;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Native dark "no connection" screen in the app's style. Never shows Chrome's error page. */
final class OfflineScreen extends FrameLayout {
    OfflineScreen(Context c, Runnable onRetry) {
        super(c);
        setBackgroundColor(MainActivity.BG);
        setClickable(true);          // swallow touches meant for the page below
        float d = c.getResources().getDisplayMetrics().density;
        LinearLayout col = new LinearLayout(c);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        col.setPadding((int) (32 * d), (int) (24 * d), (int) (32 * d), (int) (24 * d));

        ImageView icon = new ImageView(c);
        icon.setImageResource(R.drawable.ic_offline);
        icon.setAlpha(0.9f);
        col.addView(icon, new LinearLayout.LayoutParams((int) (72 * d), (int) (72 * d)));

        TextView title = new TextView(c);
        title.setText(R.string.offline_title);
        title.setTextColor(Color.parseColor("#F4F2EE"));
        title.setTextSize(20);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(-2, -2);
        tp.topMargin = (int) (20 * d);
        col.addView(title, tp);

        TextView sub = new TextView(c);
        sub.setText(R.string.offline_sub);
        sub.setTextColor(Color.parseColor("#9A97A0"));
        sub.setTextSize(14.5f);
        sub.setGravity(Gravity.CENTER);
        sub.setLineSpacing(0, 1.15f);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-2, -2);
        sp.topMargin = (int) (8 * d);
        col.addView(sub, sp);

        TextView btn = new TextView(c);
        btn.setText(R.string.offline_retry);
        btn.setTextColor(Color.parseColor("#1B1526"));
        btn.setTextSize(16);
        btn.setTypeface(Typeface.DEFAULT_BOLD);
        btn.setGravity(Gravity.CENTER);
        btn.setMinHeight((int) (48 * d));
        btn.setPadding((int) (36 * d), (int) (12 * d), (int) (36 * d), (int) (12 * d));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#C4B5E8"));
        bg.setCornerRadius(24 * d);
        btn.setBackground(bg);
        btn.setClickable(true);
        btn.setOnTouchListener((v, e) -> {
            int a = e.getActionMasked();
            v.setAlpha(a == android.view.MotionEvent.ACTION_DOWN ? 0.8f : (a == android.view.MotionEvent.ACTION_MOVE ? v.getAlpha() : 1f));
            return false;
        });
        btn.setOnClickListener(v -> onRetry.run());
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-2, -2);
        bp.topMargin = (int) (28 * d);
        col.addView(btn, bp);

        addView(col, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        setVisibility(View.GONE);
    }
}
