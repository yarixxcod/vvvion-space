package space.vvvion.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

public class BalanceWidget extends AppWidgetProvider {
    @Override public void onUpdate(final Context c, AppWidgetManager m, int[] ids) {
        Widgets.renderBalance(c);   // cached value at once
        final PendingResult pr = goAsync();
        new Thread(() -> {
            try { Widgets.fetchBalance(c); Widgets.renderBalance(c); } catch (Throwable ignored) {} finally { pr.finish(); }
        }, "vv-widget-balance").start();
    }
    @Override public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, android.os.Bundle o) { Widgets.renderBalance(c); }
}
