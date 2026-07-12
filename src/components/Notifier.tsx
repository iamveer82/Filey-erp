import { useEffect } from "react";
import { erp, quotes, tools } from "../lib/api";
import { useUI } from "../lib/ui";
import { useLiveSync } from "../lib/realtime";

/* In-app delivery for the Settings → Notifications toggles. Each event is
 * gated by its saved preference (default on) and deduped so it fires once per
 * occurrence, not on every refresh. Email/push delivery still needs a server
 * integration — this covers the in-app half.
 *
 * ponytail: client-side checks on load + live-sync. A server-pushed feed
 * (notifications table) is the upgrade path if cross-device delivery matters. */

type Toast = ReturnType<typeof useUI>["toast"];

const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((+t - +yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${week}`;
};

/* Fire `fire(count)` for ids greater than the stored baseline, then advance it.
 * The first call (no baseline) only records, so existing rows never trigger a
 * flood of stale notifications. */
function notifyNew(key: string, ids: number[], fire: (count: number) => void) {
  if (ids.length === 0) return;
  const max = Math.max(...ids);
  const prev = localStorage.getItem(key);
  if (prev != null) {
    const baseline = Number(prev);
    const fresh = ids.filter((id) => id > baseline).length;
    if (fresh > 0) fire(fresh);
  }
  localStorage.setItem(key, String(max));
}

/* `firstPass` runs the session-once + weekly checks too; live-sync re-checks
 * only the event-arrival paths (new order / accepted quote). */
async function check(toast: Toast, firstPass: boolean) {
  const settings = await tools.settings().catch(() => []);
  // Preferences default on — only an explicit "off" disables an event.
  const on = (key: string) => settings.find((s) => s.key === key)?.value !== "off";

  if (on("notif.neworder")) {
    const orders = await erp.orders().catch(() => []);
    notifyNew("notif.order.maxid", orders.map((o) => o.id), (n) =>
      toast.notify({
        title: "New order",
        message: `${n} new sales order${n > 1 ? "s" : ""} received.`,
        to: "/orders",
      })
    );
  }

  if (on("notif.quote")) {
    const accepted = (await quotes.listDocs().catch(() => []))
      .filter((q) => q.status === "accepted")
      .map((q) => q.id);
    notifyNew("notif.quote.seen", accepted, (n) =>
      toast.notify({
        title: "Quotation accepted",
        message: `${n} quotation${n > 1 ? "s were" : " was"} accepted.`,
        to: "/quoting",
      })
    );
  }

  if (!firstPass) return;

  // Low-stock — at most once per day. sessionStorage resets on every app
  // launch (fresh webview), which made this re-toast on each open; a
  // localStorage date key survives restarts.
  const today = new Date().toISOString().slice(0, 10);
  if (on("notif.lowstock") && localStorage.getItem("notif.lowstock.day") !== today) {
    const low = (await erp.products().catch(() => [])).filter(
      (p) => p.quantity <= p.reorder_level
    );
    if (low.length > 0)
      toast.notify({
        title: "Low stock",
        message: `${low.length} product${low.length > 1 ? "s are" : " is"} at or below reorder level.`,
        to: "/inventory",
      });
    localStorage.setItem("notif.lowstock.day", today);
  }

  // Weekly summary — at most once per week, on/after Monday.
  if (on("notif.weekly") && new Date().getDay() === 1) {
    const week = isoWeek(new Date());
    if (localStorage.getItem("notif.weekly.week") !== week) {
      toast.notify({
        title: "Weekly summary",
        message: "Your weekly activity digest is ready in Reports.",
        to: "/reports",
      });
      localStorage.setItem("notif.weekly.week", week);
    }
  }
}

export default function Notifier() {
  const { toast } = useUI();
  useEffect(() => {
    check(toast, true).catch((e) => console.error("Notifier check failed:", e));
    // toast is recreated each render — intentionally excluded from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLiveSync(() => void check(toast, false).catch(() => {}));
  return null;
}
