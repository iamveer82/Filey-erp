export type CustomerOpeningBalance = {
  payable: string;
  receivable: string;
};

/** Existing records store one signed AED balance: + receivable, - payable. */
export function customerOpeningBalanceInputs(balance?: number): CustomerOpeningBalance {
  return {
    payable: balance != null && balance < 0 ? String(-balance) : "",
    receivable: balance != null && balance !== 0 && !(balance < 0) ? String(balance) : "",
  };
}

export function readCustomerOpeningBalance(input: CustomerOpeningBalance):
  | { value: number; error: null }
  | { value: null; error: string } {
  const amounts: Record<keyof CustomerOpeningBalance, number> = { payable: 0, receivable: 0 };
  for (const side of ["payable", "receivable"] as const) {
    const text = input[side].trim();
    if (!text) continue;
    if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text)) {
      return { value: null, error: `Enter a non-negative ${side} amount with at most two decimal places.` };
    }
    const value = Number(text);
    // Match payment entry limits; larger JS numbers can lose a cent on conversion.
    if (!Number.isFinite(value) || value >= 1e12) {
      return { value: null, error: `The ${side} amount is too large to save accurately.` };
    }
    amounts[side] = value;
  }
  if (amounts.payable > 0 && amounts.receivable > 0) {
    return { value: null, error: "Enter either payable or receivable. Clear one amount before saving." };
  }
  // Always write zero when cleared, so an update cannot leave an old balance behind.
  return { value: amounts.payable > 0 ? -amounts.payable : amounts.receivable, error: null };
}
