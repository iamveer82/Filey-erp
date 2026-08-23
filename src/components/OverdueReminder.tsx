import { useEffect } from "react";
import { billing } from "../lib/api";
import { useUI } from "../lib/ui";
import { todayYmd } from "../lib/format";

/* Once per session, nudge the user if invoices are overdue. The overdue
 * "auto-reminder" half of #17 (recurring generation needs a DB migration). */

const FLAG = "filey.overdue.notified";

export default function OverdueReminder() {
  const { toast } = useUI();
  // Run once on mount. toast must stay OUT of the deps: notifying re-renders
  // the UIProvider, toast gets a new identity, and the effect would re-fire
  // before the async FLAG write lands — duplicate fetch + duplicate toast.
  useEffect(() => {
    if (sessionStorage.getItem(FLAG)) return;
    let active = true;
    billing
      .listDocs()
      .then((docs) => {
        if (!active) return;
        const today = todayYmd();
        const overdue = docs.filter(
          (d) =>
            (d.balance ?? 0) > 0 &&
            !!d.due_date &&
            d.due_date < today &&
            d.status !== "paid"
        );
        if (overdue.length > 0) {
          toast.notify({
            title: "Overdue invoices",
            message: `${overdue.length} invoice${overdue.length > 1 ? "s are" : " is"} past due - time to follow up.`,
          });
        }
        sessionStorage.setItem(FLAG, "1");
      })
      .catch((e) => console.error("Failed to check overdue invoices:", e));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
