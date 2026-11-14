package space.vvvion.app;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Compiled only when app/google-services.json exists.
 * Server sends DATA-ONLY high-priority messages: {title, body, url, channel, id, fg}. Without "fg=1" nothing is shown
 * while the app is open (the web UI already shows it).
 */
public class PushService extends FirebaseMessagingService {
    @Override public void onNewToken(String token) { PushStore.setToken(this, token); }

    @Override public void onMessageReceived(RemoteMessage m) {
        Map<String, String> d = m.getData();
        String title = d.get("title"), body = d.get("body");
        if (title == null && m.getNotification() != null) { title = m.getNotification().getTitle(); body = m.getNotification().getBody(); }
        if (title == null) return;
        boolean fg = "1".equals(d.get("fg"));
        AppNotifier.show(this, d.get("id"), d.get("channel"), title, body, d.get("url"), !fg);
    }
}
