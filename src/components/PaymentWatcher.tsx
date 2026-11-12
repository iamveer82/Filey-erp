import { useEffect } from "react";
import { billing } from "../lib/api";
import { companyCountry } from "../lib/companyCountry";
import { money } from "../lib/format";
import { toast } from "./Toaster";

const FIRST_CHECK_MS = 60_000;
const EVERY_MS = 5 * 60_000;

/** Indian businesses: look for UPI payments in bank alerts every few minutes while Filey is
 *  open (Gmail connected, automatic checking not turned off). Matches wait in Invoicing →
 *  Payment check; nothing is recorded without the owner. */
export default function PaymentWatcher() {
  useEffect(() => {
    let stopped = false;
    let failures = 0;
    const tick = async () => {
      if (stopped || failures >= 3) return;
      try {
        const company = await billing.getCompany();
        if (!company || companyCountry(company) !== "IN") return;
        // Loaded only for Indian businesses, so the Gmail connector stays out of everyone else's start-up.
        const { checkPayments, gmailConnected, loadAlertState } = await import("../lib/paymentWatch");
        if ((await loadAlertState()).auto === false || !(await gmailConnected())) return;
        const { added, matches } = await checkPayments();
        const hits = matches.filter((m) => m.candidates.length && added.some((a) => a.key === m.alert.key));
        if (hits.length && !stopped)
          toast.info(hits.length === 1
            ? `UPI payment of ${money(hits[0].alert.amount, "INR")} matches ${hits[0].candidates[0].number}. Confirm it in Invoicing → Payment check.`
            : `${hits.length} UPI payments match unpaid invoices. Confirm them in Invoicing → Payment check.`);
        failures = 0;
      } catch {
        failures += 1; // a few failures in a row (signed out, connector down) stop the watch until the next launch
      }
    };
    const first = setTimeout(() => { void tick(); }, FIRST_CHECK_MS);
    const every = setInterval(() => { void tick(); }, EVERY_MS);
    return () => { stopped = true; clearTimeout(first); clearInterval(every); };
  }, []);
  return null;
}
