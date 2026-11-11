import { createFileRoute } from "@tanstack/react-router";
import { purchaseSku } from "@/lib/pay/shop.server";
import { json, requireUser } from "@/lib/pay/topup.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/shop/purchase")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await requireUser(request);
        if (typeof user !== "string") return json(user.status, user.body);
        let body: { sku?: unknown; idempotencyKey?: unknown } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          body = {};
        }
        const sku = typeof body.sku === "string" ? body.sku.trim() : "";
        const idem = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
        if (!sku || !UUID.test(idem)) return json(400, { code: "bad_sku", message: "Такого товара нет" });
        const result = await purchaseSku(user, sku, idem);
        return json(result.status, result.body);
      },
    },
  },
});
