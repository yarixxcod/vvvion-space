import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { createInvoice, getInvoices, PayError, verifySignature } from "./cryptopay.ts";

const token = "unit-test-token";

function sign(body: string): string {
  const key = createHash("sha256").update(token).digest();
  return createHmac("sha256", key).update(body, "utf8").digest("hex");
}

test("signature accepts the raw body only", () => {
  const body = '{"update_id":1,"update_type":"invoice_paid"}';
  const header = sign(body);
  assert.equal(verifySignature(body, header, token), true);
  assert.equal(verifySignature(body, header.toUpperCase(), token), true);
  assert.equal(verifySignature(`${body} `, header, token), false);
  assert.equal(verifySignature('{\n  "update_id": 1,\n  "update_type": "invoice_paid"\n}', header, token), false);
  assert.equal(verifySignature(body, `${header.slice(0, -2)}00`, token), false);
  assert.equal(verifySignature(body, "", token), false);
  assert.equal(verifySignature(body, "zz", token), false);
  assert.equal(verifySignature(body, "ab", token), false);
  assert.equal(verifySignature(body, null, token), false);
  assert.equal(verifySignature(body, header, ""), false);
});

test("createInvoice sends fiat rubles as a string and hides the token from errors", async () => {
  let seen = "";
  const fetchImpl: typeof fetch = async (url, init) => {
    seen = String(url);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Crypto-Pay-API-Token"), token);
    const body = JSON.parse(String(init?.body)) as { currency_type: string; fiat: string; amount: string; payload: string };
    assert.equal(body.currency_type, "fiat");
    assert.equal(body.fiat, "RUB");
    assert.equal(body.amount, "100.00");
    assert.equal(typeof body.amount, "string");
    assert.equal(body.payload, "topup-id");
    return new Response(JSON.stringify({ ok: true, result: { invoice_id: 7, status: "active", bot_invoice_url: "https://t.me/CryptoBot?start=t" } }));
  };
  const invoice = await createInvoice(
    {
      currency_type: "fiat",
      fiat: "RUB",
      amount: "100.00",
      accepted_assets: "USDT,TON",
      description: "VVVion: 980 вублей",
      payload: "topup-id",
      expires_in: 1800,
      paid_btn_name: "callback",
      paid_btn_url: "https://vvvion.space/?place=shop&topup=topup-id",
      allow_comments: false,
      hidden_message: "ok",
    },
    { token, network: "mainnet", fetchImpl },
  );
  assert.equal(seen, "https://pay.crypt.bot/api/createInvoice");
  assert.equal(invoice.invoice_id, 7);
  const failing: typeof fetch = async () => new Response(JSON.stringify({ ok: false, error: { name: "TOKEN_INVALID" } }), { status: 401 });
  await assert.rejects(
    () =>
      createInvoice(
        {
          currency_type: "fiat",
          fiat: "RUB",
          amount: "50.00",
          accepted_assets: "USDT",
          description: "x",
          payload: "id",
          expires_in: 1800,
          paid_btn_name: "callback",
          paid_btn_url: "https://vvvion.space/?place=bank&topup=id",
          allow_comments: false,
          hidden_message: "x",
        },
        { token: "secret-token-xyz", network: "testnet", fetchImpl: failing },
      ),
    (err: unknown) => err instanceof PayError && err.code === "provider_error" && !String(err.message).includes("secret-token"),
  );
});

test("getInvoices accepts both list shapes", async () => {
  const arrayFetch: typeof fetch = async () => new Response(JSON.stringify({ ok: true, result: [{ invoice_id: 1, status: "paid" }] }));
  const itemsFetch: typeof fetch = async () => new Response(JSON.stringify({ ok: true, result: { items: [{ invoice_id: 2, status: "active" }] } }));
  const rows = await getInvoices([1], { token, fetchImpl: arrayFetch });
  const wrapped = await getInvoices([2], { token, fetchImpl: itemsFetch });
  assert.equal(rows[0]?.invoice_id, 1);
  assert.equal(wrapped[0]?.status, "active");
});
