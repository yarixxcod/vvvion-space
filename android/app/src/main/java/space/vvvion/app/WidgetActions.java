package space.vvvion.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Player widget buttons. Not exported: only our own PendingIntents reach it. */
public class WidgetActions extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        String a = i == null ? null : i.getAction();
        if (Widgets.ACT_PLAY.equals(a) || Widgets.ACT_PREV.equals(a) || Widgets.ACT_NEXT.equals(a)) Widgets.handleAction(c, a);
    }
}
