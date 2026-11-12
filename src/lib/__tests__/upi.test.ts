import { expect, it } from "vitest";
import { upiError, upiLink } from "../upi";

it("builds the NPCI upi://pay link with payee, amount and note", () => {
  expect(upiLink({ vpa: "dune@okhdfcbank", name: "Dune Lubricants & Oil", amount: 1180, note: "Invoice INV-7" }))
    .toBe("upi://pay?pa=dune%40okhdfcbank&pn=Dune%20Lubricants%20%26%20Oil&am=1180.00&cu=INR&tn=Invoice%20INV-7");
  expect(upiLink({ vpa: "9876543210@paytm" })).toBe("upi://pay?pa=9876543210%40paytm&cu=INR");
});

it("checks the shape of a UPI ID", () => {
  expect(upiError("dune@okhdfcbank")).toBe("");
  expect(upiError("9876543210@ybl")).toBe("");
  expect(upiError("dune.okhdfcbank")).toMatch(/UPI ID looks like/);
  expect(upiError("")).toBe("");
});
