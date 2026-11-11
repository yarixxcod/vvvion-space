import { createFileRoute } from "@tanstack/react-router";
import { invoiceView, safeEqual, verifySignature, type CryptoInvoice } from "@/lib/pay/cryptopay";
import { payFlags } from "@/lib/pay/flags";
import { getInvoices } from "@/lib/pay/cryptopay";
import { logWebhook, settleFromProvider } from "@/lib/pay/topup.server";

export const Route = createFileRoute("/api/webhooks/cryptopay/$secret")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const flags = payFlags();
        if (!flags.webhookSecret || !safeEqual(params.secret, flags.webhookSecret)) {
          return new Response(null, { status: 404 });
        }
        const raw = await request.text();
        const header = request.headers.get("crypto-pay-api-signature");
        if (!flags.token || !verifySignature(raw, header, flags.token)) {
          await logWebhook({ signatureOk: false, outcome: "bad_signature" }).catch(() => undefined);
          return new Response(null, { status: 401 });
        }
        let update: { update_id?: number; update_type?: string; request_date?: string; payload?: CryptoInvoice };
        try {
          update = JSON.parse(raw) as typeof update;
        } catch {
          return new Response(null, { status: 200 });
        }
        if (update.update_type !== "invoice_paid" || update.payload?.status !== "paid") {
          await logWebhook({
            signatureOk: true,
            outcome: "ignored",
            updateId: update.update_id ?? null,
            updateType: update.update_type ?? null,
            invoiceId: update.payload?.invoice_id ? String(update.payload.invoice_id) : null,
          }).catch(() => undefined);
          return new Response(null, { status: 200 });
        }
        let inv = update.payload;
        const parsed = typeof update.request_date === "string" ? Date.parse(update.request_date) : Number.NaN;
        const stale = !Number.isFinite(parsed) || Math.abs(Date.now() - parsed) > 10 * 60_000;
        if (stale) {
          try {
            const [fresh] = await getInvoices([inv.invoice_id]);
            if (!fresh) return new Response(null, { status: 503 });
            inv = fresh;
          } catch {
            return new Response(null, { status: 503 });
          }
        }
        let outcome = "ignored";
        try {
          outcome = await settleFromProvider(inv, stale);
          if (stale && outcome === "credited") outcome = "stale_verified";
        } catch (err) {
          console.error("[pay] webhook", err instanceof Error ? err.name : "error");
          return new Response(null, { status: 500 });
        }
        const view = invoiceView(inv);
        await logWebhook({
          signatureOk: true,
          outcome,
          updateId: update.update_id ?? null,
          updateType: update.update_type ?? null,
          invoiceId: view.invoiceId,
        }).catch(() => undefined);
        return new Response(null, { status: 200 });
      },
    },
  },
});
