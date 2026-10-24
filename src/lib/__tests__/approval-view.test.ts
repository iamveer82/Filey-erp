import { expect, it } from "vitest";
import { describeApproval, expiresIn } from "../approvalView";

it("leads with the amount, says who it is for, and names the action", () => {
  const view = describeApproval("record_invoice_payment", { invoice_number: "INV-0023", amount: 640, currency: "AED", method: "cash" });
  expect(view.headline).toMatch(/640\.00/);
  expect(view.headline).toMatch(/AED/);
  expect(view.subtitle).toBe("INV-0023");
  expect(view.action).toBe("Record invoice payment");
  expect(view.details).toEqual([["invoice number", "INV-0023"], ["amount", "640"], ["currency", "AED"], ["method", "cash"]]);
});

it("without an amount, the action is the headline and the recipient the subtitle", () => {
  const view = describeApproval("send_whatsapp", { to: "+971500000001", text: "Your invoice is attached" });
  expect(view.headline).toBe("Send whatsapp");
  expect(view.subtitle).toBe("+971500000001");
});

it("counts down to expiry and stops once it lapses", () => {
  const now = Date.parse("2026-10-23T10:00:00Z");
  expect(expiresIn(now + 8 * 60_000, now)).toBe("Expires in 8 min");
  expect(expiresIn(now + 5 * 3_600_000, now)).toBe("Expires in 5 h");
  expect(expiresIn(now + 3 * 86_400_000, now)).toBe("Expires in 3 days");
  expect(expiresIn(now - 1, now)).toBeNull();
});
