import { useState } from "react";
import { Download } from "lucide-react";
import { billing, erp, crm, fin, quotes } from "../../lib/api";

export default function BackupPanel() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const exportData = async () => {
    setBusy(true);
    try {
      const [company, products, orders, invoices, quotations, customers, expenses] =
        await Promise.all([
          billing.getCompany().catch(() => null),
          erp.products().catch(() => []),
          erp.orders().catch(() => []),
          billing.listDocs().catch(() => []),
          quotes.listDocs().catch(() => []),
          crm.customers().catch(() => []),
          fin.expenses().catch(() => []),
        ]);
      const blob = new Blob(
        [
          JSON.stringify(
            {
              exported_at: new Date().toISOString(),
              app: "filey-erp",
              company,
              products,
              orders,
              invoices,
              quotations,
              customers,
              expenses,
            },
            null,
            2
          ),
        ],
        { type: "application/json" }
      );
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `filey-backup-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      setDone(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <p className="font-bold text-ink">Export data</p>
        <p className="text-sm text-brand-500 mt-0.5 mb-4">
          Download a JSON snapshot of your company, products, orders,
          invoices, quotations, customers and expenses.
        </p>
        <button className="btn-primary" disabled={busy} onClick={exportData}>
          <Download size={16} /> {busy ? "Preparing…" : "Export backup"}
        </button>
        {done && (
          <span className="ml-3 text-sm font-semibold text-success">
            Backup downloaded
          </span>
        )}
      </div>
      <div className="card">
        <p className="font-bold text-ink">Restore</p>
        <p className="text-sm text-brand-500 mt-2">
          Your source of truth is your Supabase project — restore from a
          Supabase backup (Dashboard → Database → Backups), or contact the
          owner to re-import an exported file. In-app restore/import is on
          the roadmap.
        </p>
      </div>
    </div>
  );
}
