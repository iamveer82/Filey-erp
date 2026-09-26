import { Link } from "react-router-dom";
import { useState } from "react";
import { Download } from "lucide-react";
import { billing, erp, crm, fin, hr, quotes } from "../../lib/api";
import { useSettings } from "./PreferencesPanel";
import { errMsg, todayYmd } from "../../lib/format";
import { hasTauri, saveBytes } from "../../lib/localPaths";
import { SettingsPanel, SettingsSection } from "../../components/SettingsLayout";

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
      const [
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
      ] = values;
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
        const saved = await saveBytes(name, new TextEncoder().encode(json));
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
    <SettingsPanel>
      <SettingsSection
        title="Export summaries"
        description="Download selected business data as a JSON file."
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          Includes company, products, orders, invoice and quotation summaries, customers,
          expenses, accounts, transactions and employees. This export does not include
          every module, document line or file attachment.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={exportData} disabled={busy} className="btn-primary">
            <Download size={16} /> {busy ? "Preparing…" : "Export now"}
          </button>
          {done && !busy && (
            <span role="status" className="text-sm text-success">
              Downloaded
            </span>
          )}
        </div>
        {err && !busy && (
          <p role="alert" className="text-sm text-danger">
            {err}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Last export:{" "}
          {ready && lastExportAt ? new Date(lastExportAt).toLocaleString() : "never"}
        </p>
      </SettingsSection>
      <SettingsSection
        title="Full backup & restore"
        description="Keep a complete copy of your local workspace."
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          Desktop full backups include the local database and saved files. Create and
          restore them in Data & Storage. For cloud disaster recovery, use your Supabase
          database and Storage backups.
        </p>
        <Link
          className="btn-ghost max-w-full whitespace-normal text-center"
          to="/settings?section=datamode"
        >
          Open full desktop backup & restore
        </Link>
      </SettingsSection>
    </SettingsPanel>
  );
}
