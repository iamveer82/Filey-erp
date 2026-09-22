import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PaymentReview from "../PaymentReview";

afterEach(cleanup);
it("reviews the fee before payment, prevents duplicate handoffs, and only confirms verified payment", async () => {
  let finish!: (value: "browser") => void;
  const onPay = vi.fn(
    () =>
      new Promise<"browser">((resolve) => {
        finish = resolve;
      })
  );
  const onVerify = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(
    <PaymentReview
      title="Add AI credits"
      lines={[
        { label: "Spendable AI credit", value: "$5.00" },
        { label: "Filey service fee", value: "$0.50" },
      ]}
      total="$5.50 USD"
      terms="One-time top-up."
      onPay={onPay}
      onVerify={onVerify}
      onBack={() => {}}
    />
  );
  expect(onPay).not.toHaveBeenCalled();
  expect(screen.getByText("$0.50")).toBeTruthy();
  const pay = screen.getByRole("button", { name: "Continue to payment" });
  fireEvent.click(pay);
  fireEvent.click(pay);
  expect(onPay).toHaveBeenCalledTimes(1);
  finish("browser");
  fireEvent.click(await screen.findByRole("button", { name: /Check payment/ }));
  await screen.findByText(/Payment is not confirmed yet/);
  expect(screen.queryByText(/Payment confirmed\./)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Check payment/ }));
  await screen.findByText(/Payment confirmed\./);
  expect(onPay).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: /Check payment/ })).toBeNull();
});

it("keeps a failed checkout visible and permits an explicit retry", async () => {
  const onPay = vi
    .fn()
    .mockRejectedValue(new Error("Payments are temporarily unavailable."));
  render(
    <PaymentReview
      title="Get Filey Pro"
      lines={[]}
      total="$5 USD"
      terms="Monthly subscription."
      onPay={onPay}
      onVerify={vi.fn()}
      onBack={vi.fn()}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Payments are temporarily unavailable."
  );
  expect(screen.getByRole("button", { name: "Continue to payment" })).toBeEnabled();
  expect(onPay).toHaveBeenCalledTimes(1);
});
