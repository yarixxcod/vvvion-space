package space.vvvion.app;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.nio.charset.StandardCharsets;

/** Per-document authority; never persisted, logged or exposed as a JS property. */
final class BridgeCapability {
    private volatile String token;
    BridgeCapability() { rotate(); }
    void rotate() {
        byte[] random = new byte[32];
        new SecureRandom().nextBytes(random);
        StringBuilder hex = new StringBuilder(64);
        for (byte b : random) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        token = hex.toString();
    }
    String value() { return token; }
    boolean accepts(String candidate) {
        return candidate != null && candidate.length() == 64
            && MessageDigest.isEqual(token.getBytes(StandardCharsets.US_ASCII), candidate.getBytes(StandardCharsets.US_ASCII));
    }
}
