package space.vvvion.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

public class RatesWidget extends AppWidgetProvider {
    @Override public void onUpdate(final Context c, AppWidgetManager m, int[] ids) {
        Widgets.renderRates(c);   // cached value at once
        final PendingResult pr = goAsync();
        new Thread(() -> {
            try { Widgets.fetchRates(c); Widgets.renderRates(c); } catch (Throwable ignored) {} finally { pr.finish(); }
        }, "vv-widget-rates").start();
    }
    @Override public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, android.os.Bundle o) { Widgets.renderRates(c); }
}
