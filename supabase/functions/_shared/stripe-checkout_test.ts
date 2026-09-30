import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { stripeAmountToMinorUnits, stripeCheckoutArgs, type StripeCheckout } from "./stripe-checkout.ts";

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

Deno.test("checkout and paid settlement preserve USD, AED, JPY and KRW major amounts", () => {
  for (const [currency, amount, minor] of [
    ["USD", 125.25, 12525], ["AED", 125.25, 12525], ["JPY", 1000, 1000], ["KRW", 25000, 25000],
  ] as const) {
    assertEquals(stripeAmountToMinorUnits(amount, currency), minor);
    assertEquals(stripeCheckoutArgs({ ...invoice, currency: currency.toLowerCase(), amount_total: minor })?.p_amount, amount);
  }
});

Deno.test("three-decimal Gulf charges use thousandths while charge-only special cases remain correct", () => {
  for (const currency of ["BHD", "JOD", "KWD", "OMR", "TND"]) {
    assertEquals(stripeAmountToMinorUnits(12.34, currency), 12340);
    assertEquals(stripeCheckoutArgs({ ...invoice, currency, amount_total: 12340 })?.p_amount, 12.34);
    assertThrows(() => stripeAmountToMinorUnits(12.345, currency));
  }
  for (const currency of ["ISK", "UGX"]) {
    assertEquals(stripeAmountToMinorUnits(500, currency), 50000);
    assertEquals(stripeCheckoutArgs({ ...invoice, currency, amount_total: 50000 })?.p_amount, 500);
    assertThrows(() => stripeAmountToMinorUnits(500.5, currency));
  }
  for (const currency of ["HUF", "TWD"])
    assertEquals(stripeAmountToMinorUnits(12.34, currency), 1234);
});

Deno.test("checkout rejects fractional zero-decimal balances and invalid amounts before charging", () => {
  for (const currency of ["JPY", "KRW"])
    for (const amount of [0.1, 1000.5]) assertThrows(() => stripeAmountToMinorUnits(amount, currency));
  for (const amount of [NaN, Infinity, -1, 0, 0.001, Number.MAX_SAFE_INTEGER])
    assertThrows(() => stripeAmountToMinorUnits(amount, "USD"));
  assertThrows(() => stripeAmountToMinorUnits(10, ""));
  assertEquals(stripeAmountToMinorUnits(0.29, "USD"), 29);
});
