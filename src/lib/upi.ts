/* UPI payment links (NPCI "upi://pay" deep link), as printed in an invoice's
 * Scan-to-pay QR code. Any UPI app (GPay, PhonePe, Paytm, BHIM, bank apps)
 * reads it and fills in the payee, amount and note. */

const VPA = /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,64}$/;

/** "" when the UPI ID looks right, else what is wrong. */
export function upiError(value?: string | null): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  return VPA.test(v) ? "" : "A UPI ID looks like yourname@okhdfcbank or 9876543210@paytm.";
}

export function upiLink({ vpa, name, amount, note }: { vpa: string; name?: string | null; amount?: number; note?: string | null }): string {
  const params = [
    ["pa", vpa.trim()],
    ["pn", (name ?? "").trim().slice(0, 50)],
    ...(amount && amount > 0 ? [["am", amount.toFixed(2)]] : []),
    ["cu", "INR"],
    ["tn", (note ?? "").trim().slice(0, 80)],
  ].filter(([, v]) => v);
  return `upi://pay?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}
