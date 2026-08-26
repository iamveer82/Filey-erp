import { useState } from "react";
import { Download, Info, Upload } from "lucide-react";
import { billing, erp, crm, fin, hr, quotes } from "../../lib/api";
import { useSettings } from "./PreferencesPanel";
import { cn, errMsg, todayYmd } from "../../lib/format";
import { hasTauri, saveBytes } from "../../lib/localPaths";

/* ---------------- Backup & Restore ----------------
   Reference two-card layout. Export is the real API snapshot; in-app
   restore is honestly marked as roadmap (source of truth = Supabase). */

export default function BackupPanel() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const { get, set, ready } = useSettings();
  const lastExportAt = get("backup.last_export_at", "");

  const exportData = async () => {
    setBusy(true);
    setErr("");
    setDone(false);
    try {
      // Each source used to carry its own .catch that substituted null or [],
      // so a section that failed to read was written out as "you have none of
      // these" and still reported "Downloaded". A backup silently missing your
      // invoices is far more dangerous than an export that refuses to run, so
      // collect the failures and write nothing if there are any.
      const sources = [
        ["company", () => billing.getCompany()],
        ["products", () => erp.products()],
        ["orders", () => erp.orders()],
        ["invoices", () => billing.listDocs()],
        ["quotations", () => quotes.listDocs()],
        ["customers", () => crm.customers()],
        ["expenses", () => fin.expenses()],
        ["accounts", () => fin.accounts()],
        ["transactions", () => fin.transactions()],
        ["employees", () => hr.employees()],
      ] as const;
      const settled = await Promise.allSettled(sources.map(([, load]) => load()));
      const failed = sources
        .filter((_, i) => settled[i].status === "rejected")
        .map(([name]) => name);
      if (failed.length)
        throw new Error(
          `Could not read ${failed.join(", ")}. Nothing was downloaded - a backup missing data is worse than none.`
        );
      const values = settled.map((r) => (r as PromiseFulfilledResult<unknown>).value);
      const [company, products, orders, invoices, quotations, customers, expenses, accounts, transactions, employees] = values;
      const json = JSON.stringify(
        {
          version: 2,
          exported_at: new Date().toISOString(),
          app: "filey-erp",
          counts: Object.fromEntries(
            sources.map(([name], i) => {
              const v = values[i];
              return [name, Array.isArray(v) ? v.length : v ? 1 : 0];
            })
          ),
          company,
          products,
          orders,
          invoices,
          quotations,
          customers,
          expenses,
          accounts,
          transactions,
          employees,
        },
        null,
        2
      );
      const name = `filey-backup-${todayYmd()}.json`;
      // Desktop: a blob `<a download>` click silently fails in the Tauri
      // WebView2 — the backup must go through the native save dialog.
      if (hasTauri) {
        const saved = await saveBytes(
          name,
          new TextEncoder().encode(json)
        );
        if (!saved) return; // user cancelled the dialog
      } else {
        const blob = new Blob([json], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
      setDone(true);
      set("backup.last_export_at", new Date().toISOString());
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-6 pt-5 pb-4 border-b border-border">
        <div className="text-[15px] font-semibold text-ink">
          Backup &amp; Restore
        </div>
        <div className="text-[13px] text-muted-foreground mt-1">
          Export a complete snapshot of your workspace as a single JSON file.
        </div>
      </div>
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-border p-4 flex items-start gap-3">
            <div className="h-9 w-9 rounded-md bg-hover grid place-items-center text-foreground shrink-0">
              <Download className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold text-foreground">
                Download backup
              </div>
              <div className="text-[12.5px] text-muted-foreground">
                Company, products, orders, invoices, quotations, customers,
                expenses, accounts, transactions and employees — the full
                ledger and books.
              </div>
              <button
                onClick={exportData}
                disabled={busy}
                className="mt-3 h-8 px-3 rounded-md text-[12.5px] font-medium bg-foreground text-background hover:opacity-90 cursor-pointer disabled:opacity-60 transition-opacity"
              >
                {busy ? "Preparing…" : "Export now"}
              </button>
              {done && !busy && (
                <span className="ml-2 text-[12px] font-medium text-success">
                  Downloaded
                </span>
              )}
              {err && !busy && (
                <p className="mt-2 text-[12.5px] font-medium text-danger">{err}</p>
              )}
            </div>
          </div>
          <div className="rounded-lg border border-border p-4 flex items-start gap-3">
            <div className="h-9 w-9 rounded-md bg-hover grid place-items-center text-foreground shrink-0">
              <Upload className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold text-foreground">
                Restore from backup
              </div>
              <div className="text-[12.5px] text-muted-foreground">
                Your source of truth is your Supabase project - restore from a
                Supabase backup (Dashboard → Database → Backups), or contact the
                owner to re-import an exported file. In-app restore is on the
                roadmap.
              </div>
            </div>
          </div>
        </div>

        <div
          className={cn(
            "rounded-lg border border-dashed border-border p-3 text-[12px] text-muted-foreground",
            "flex items-center gap-2"
          )}
        >
          <Info className="h-3.5 w-3.5 shrink-0" />
          Last export:{" "}
          {ready && lastExportAt
            ? new Date(lastExportAt).toLocaleString()
            : "never"}
        </div>
      </div>
    </div>
  );
}
