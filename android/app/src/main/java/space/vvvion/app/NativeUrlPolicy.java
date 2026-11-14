package space.vvvion.app;

import java.net.URI;

/** The authenticated native surface belongs exclusively to the canonical HTTPS origin. */
final class NativeUrlPolicy {
    static boolean isTrusted(String value) {
        try {
            URI uri = new URI(value);
            return "https".equals(uri.getScheme()) && "vvvion.space".equals(uri.getHost())
                && uri.getRawUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
        } catch (Exception ignored) { return false; }
    }
}
