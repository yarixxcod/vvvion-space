package space.vvvion.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

public class WeatherWidget extends AppWidgetProvider {
    @Override public void onUpdate(final Context c, AppWidgetManager m, int[] ids) {
        Widgets.renderWeather(c);   // cached value at once
        final PendingResult pr = goAsync();
        new Thread(() -> {
            try { Widgets.fetchWeather(c); Widgets.renderWeather(c); } catch (Throwable ignored) {} finally { pr.finish(); }
        }, "vv-widget-weather").start();
    }
    @Override public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, android.os.Bundle o) { Widgets.renderWeather(c); }
}
