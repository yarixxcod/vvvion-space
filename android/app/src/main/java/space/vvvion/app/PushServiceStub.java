package space.vvvion.app;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

/** Inert placeholder declared in the manifest when the build has no Firebase (no google-services.json). Never started. */
public class PushServiceStub extends Service {
    @Override public IBinder onBind(Intent i) { return null; }
}
