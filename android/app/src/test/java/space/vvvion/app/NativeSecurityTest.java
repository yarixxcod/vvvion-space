package space.vvvion.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class NativeSecurityTest {
    @Test public void trustsOnlyCanonicalHttpsOrigin() {
        assertTrue(NativeUrlPolicy.isTrusted("https://vvvion.space/c/shop?tab=gifts"));
        assertTrue(NativeUrlPolicy.isTrusted("https://vvvion.space:443/"));
        for (String url : new String[]{null, "http://vvvion.space", "https://evil.vvvion.space", "https://vvvion.space.evil.test", "https://vvvion.space@evil.test", "https://user@vvvion.space/", "https://vvvion.space:8443/", "javascript:alert(1)", "//evil.test/", "https://vvvion.space\\@evil.test/"}) {
            assertFalse(String.valueOf(url), NativeUrlPolicy.isTrusted(url));
        }
    }
    @Test public void refusesMissingForgedAndPreviousDocumentCapabilities() {
        BridgeCapability gate = new BridgeCapability();
        String original = gate.value();
        assertEquals(64, original.length());
        assertTrue(gate.accepts(original));
        assertFalse(gate.accepts(null));
        assertFalse(gate.accepts(""));
        assertFalse(gate.accepts("0".repeat(64)));
        gate.rotate();
        assertFalse(gate.accepts(original));
        assertTrue(gate.accepts(gate.value()));
    }
}
