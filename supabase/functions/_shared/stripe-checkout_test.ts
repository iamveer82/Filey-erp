import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { stripeCheckoutArgs, type StripeCheckout } from "./stripe-checkout.ts";

const invoice: StripeCheckout = { id: "cs_fixture", mode: "payment", payment_status: "paid", amount_total: 12500,
  currency: "aed", payment_intent: "pi_fixture", metadata: { type: "invoice_payment", invoice_id: "42" } };

Deno.test("completed-but-unpaid checkout cannot record an invoice payment or license", () => {
  for (const payment_status of ["unpaid", "no_payment_required", ""])
    assertEquals(stripeCheckoutArgs({ ...invoice, payment_status }), null);
  assertEquals(stripeCheckoutArgs({ ...invoice, payment_status: "unpaid", metadata: { type: "lite_license", user_id: "USER" } }), null);
});
Deno.test("paid checkout carries provider session identity to one atomic transaction", () => {
  assertEquals(stripeCheckoutArgs(invoice), { p_session: "cs_fixture", p_kind: "invoice_payment", p_user: null,
    p_invoice: 42, p_amount: 125, p_currency: "AED", p_intent: "pi_fixture" });
  assertEquals(stripeCheckoutArgs({ ...invoice, payment_intent: { id: "pi_fixture" } })?.p_intent, "pi_fixture");
});
Deno.test("malformed positive amount, payment reference, currency and invoice scope are rejected", () => {
  for (const patch of [{ amount_total: null }, { amount_total: 0 }, { amount_total: -1 }, { amount_total: 1.5 },
    { payment_intent: null }, { id: "" }, { currency: "" }, { mode: "subscription" },
    { metadata: { type: "invoice_payment", invoice_id: "NaN" } }])
    assertThrows(() => stripeCheckoutArgs({ ...invoice, ...patch }));
});
