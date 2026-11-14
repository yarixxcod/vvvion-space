package space.vvvion.app;

import android.content.Context;
import com.google.firebase.messaging.FirebaseMessaging;

/** Compiled only when app/google-services.json exists. Fetches the FCM token and hands it to the page. */
public final class FcmInit {
    private FcmInit() {}
    public static void init(Context c) {
        try {
            FirebaseMessaging.getInstance().getToken().addOnSuccessListener(t -> PushStore.setToken(c, t));
        } catch (Throwable ignored) {}
    }
}
