import { useEffect } from "react";
import { billing } from "../lib/api";
import { useUI } from "../lib/ui";

/* Once per session, nudge the user if invoices are overdue. The overdue
 * "auto-reminder" half of #17 (recurring generation needs a DB migration). */

const FLAG = "filey.overdue.notified";

export default function OverdueReminder() {
  const { toast } = useUI();
  useEffect(() => {
    if (sessionStorage.getItem(FLAG)) return;
    let active = true;
    billing
      .listDocs()
      .then((docs) => {
        if (!active) return;
        const today = new Date().toISOString().slice(0, 10);
        const overdue = docs.filter(
          (d) => (d.balance ?? 0) > 0 && !!d.due_date && d.due_date < today && d.status !== "paid"
        );
        if (overdue.length > 0) {
          toast.notify({
            title: "Overdue invoices",
            message: `${overdue.length} invoice${overdue.length > 1 ? "s are" : " is"} past due — time to follow up.`,
          });
        }
        sessionStorage.setItem(FLAG, "1");
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [toast]);
  return null;
}
