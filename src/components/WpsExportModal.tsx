import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download } from "lucide-react";

import { Modal, Field, Badge } from "./ui";
import { billing, type CompanyProfile, type Employee } from "../lib/api";
import { buildSif, validateWps, WpsError, type WpsInput } from "../lib/wps";
import { hasTauri, saveBytes } from "../lib/localPaths";
import { aed, errMsg, todayYmd } from "../lib/format";
import { useUI } from "../lib/ui";

/* Builds the MOHRE salary file for a period and hands it to the user. The
 * generator refuses to emit anything malformed, so this screen's real job is
 * showing exactly which employee is missing which identifier. */

/** First and last day of the month `iso` falls in. */
function monthBounds(iso: string): { start: string; end: string } {
  const d = new Date(`${iso}T00:00:00`);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const fmt = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(
      x.getDate()
    ).padStart(2, "0")}`;
  return { start: fmt(first), end: fmt(last) };
}

const daysBetween = (a: string, b: string) =>
  Math.round(
    (new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) /
      86_400_000
  ) + 1;

export default function WpsExportModal({
  open,
  employees,
  onClose,
}: {
  open: boolean;
  employees: Employee[];
  onClose: () => void;
}) {
  const { toast } = useUI();
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [start, setStart] = useState(() => monthBounds(todayYmd()).start);
  const [end, setEnd] = useState(() => monthBounds(todayYmd()).end);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    billing
      .getCompany()
      .then(setCompany)
      .catch(() => setCompany(null));
  }, [open]);

  // Only active staff are paid; a leaver on the file is a rejected file.
  const paid = useMemo(
    () => employees.filter((e) => (e.status || "active") === "active"),
    [employees]
  );

  const input = useMemo<WpsInput | null>(() => {
    if (!company) return null;
    const days = Math.max(1, Math.min(31, daysBetween(start, end)));
    return {
      employer: {
        molEstablishmentId: company.mol_establishment_id ?? "",
        bankCode: company.wps_bank_code ?? "",
      },
      employees: paid.map((e) => ({
        name: e.name,
        labourCardNo: e.labour_card_no ?? "",
        iban: e.iban ?? "",
        bankCode: e.bank_routing_code ?? "",
        fixedAmount: Number(e.salary) || 0,
        daysInPeriod: days,
      })),
      periodStart: start,
      periodEnd: end,
    };
  }, [company, paid, start, end]);

  const problems = input ? validateWps(input) : ["Loading company details…"];
  const total = paid.reduce((s, e) => s + (Number(e.salary) || 0), 0);

  const download = async () => {
    if (!input) return;
    setSaving(true);
    try {
      const file = buildSif(input);
      const bytes = new TextEncoder().encode(file.content);
      if (hasTauri) {
        const path = await saveBytes(file.filename, bytes);
        if (path) toast.success(`Saved ${file.filename}`);
      } else {
        const url = URL.createObjectURL(
          new Blob([bytes], { type: "text/plain;charset=utf-8" })
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = file.filename;
        a.click();
        URL.revokeObjectURL(url);
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof WpsError ? e.problems[0] : errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Export WPS salary file (SIF)" size="lg">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Period start">
          <input
            type="date"
            className="input"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field label="Period end">
          <input
            type="date"
            className="input"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-lg bg-muted px-3 py-2.5 text-sm">
        <span className="text-muted-foreground">
          {paid.length} active {paid.length === 1 ? "employee" : "employees"}
        </span>
        <span className="font-semibold text-foreground tabular-nums">{aed(total)}</span>
      </div>

      {problems.length > 0 && (
        <div className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-danger">
            <AlertTriangle size={15} />
            Fix these before the bank will accept the file
          </p>
          <ul className="mt-2 space-y-1">
            {problems.map((p) => (
              <li key={p} className="text-[12.5px] text-foreground">
                • {p}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Employee identifiers live on each person's record; the employer ones are in
            Settings → Company.
          </p>
        </div>
      )}

      <p className="mt-4 flex items-start gap-2 text-[12px] text-muted-foreground">
        <Badge tone="warn">Check once</Badge>
        <span>
          Column order varies slightly between banks. Send one generated file to your bank
          and confirm they accept it before running a live payroll through it.
        </span>
      </p>

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          disabled={problems.length > 0 || saving}
          onClick={download}
        >
          <Download size={15} /> {saving ? "Saving…" : "Download SIF"}
        </button>
      </div>
    </Modal>
  );
}
