import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Download, Save, Check } from "lucide-react";
import {
  hr,
  billing,
  type Employee,
  type CompanyProfile,
  type Payroll,
} from "../lib/api";
import { aed, numInput, getDisplayCurrency } from "../lib/format";
import { downloadElementAsPdf } from "../lib/pdfTools";
import { PageHeader } from "../components/ui";
import { useUI } from "../lib/ui";

export default function PayslipPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { toast, confirm } = useUI();
  const ref = useRef<HTMLDivElement>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [allowances, setAllowances] = useState(0);
  const [deductions, setDeductions] = useState(0);
  const [loading, setLoading] = useState(true);
  /** Payroll already recorded for this employee, so a period cannot be paid
   *  twice — runPayroll posts to the ledger, and a second run would double the
   *  expense and the cash credit with nothing to show it was a mistake. */
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [saving, setSaving] = useState(false);

  const loadPayroll = useCallback(() => {
    hr.payroll()
      .then(setPayroll)
      .catch(() => setPayroll([]));
  }, []);

  useEffect(() => {
    Promise.all([
      hr.employees().then((list) => {
        const emp = list.find((e) => e.id === Number(id));
        if (emp) setEmployee(emp);
      }),
      billing.getCompany().then(setCompany).catch(() => {}),
      hr.payroll().then(setPayroll).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-10 text-center text-muted-foreground">Loading…</div>;
  if (!employee) return <div className="p-10 text-center text-muted-foreground">Employee not found.</div>;

  const basic = employee.salary || 0;
  const net = basic + allowances - deductions;
  const periodLabel = new Date(month + "-01").toLocaleDateString("en", {
    month: "long",
    year: "numeric",
  });

  const download = async () => {
    const src = ref.current?.querySelector(".invoice-print") as HTMLElement | null;
    if (!src) {
      window.print(); // never leave the button doing nothing at all
      return;
    }
    // Capture from a full A4-width off-screen sheet, not the narrow preview
    // card. The exporter measures the node it is given and strips its
    // padding, so a card-sized node produced a card-sized page whose text
    // ran clipped into the right edge. Same content, real document geometry:
    // A4 width, the card's padding kept on an inner node the exporter never
    // touches.
    const holder = document.createElement("div");
    holder.setAttribute("aria-hidden", "true");
    holder.style.cssText =
      "position:fixed;left:-10000px;top:0;width:794px;background:#ffffff;";
    const sheet = document.createElement("div");
    sheet.setAttribute("data-pdf-single", "true");
    sheet.style.cssText =
      "width:794px;min-height:1123px;background:#ffffff;box-sizing:border-box;";
    const card = src.cloneNode(true) as HTMLElement;
    card.style.width = "100%";
    card.style.borderRadius = "0";
    card.style.border = "none";
    sheet.appendChild(card);
    holder.appendChild(sheet);
    document.body.appendChild(holder);
    try {
      const saved = await downloadElementAsPdf(
        sheet,
        `Payslip-${employee.name}-${month}`
      );
      // Generating a payslip IS recording it: the PDF only existed as a file
      // while the payroll history stayed empty and monthly payroll read zero.
      // Guarded by the same `recorded` lookup as the button, so a period can
      // never be posted twice.
      if (saved && !recorded && !saving) {
        setSaving(true);
        try {
          await hr.runPayroll(employee.id, month, basic, allowances, deductions);
          loadPayroll();
          toast.success(`Payslip recorded for ${periodLabel}.`);
        } catch (e) {
          toast.error(
            e instanceof Error ? e.message : "PDF saved, but recording it failed."
          );
        } finally {
          setSaving(false);
        }
      }
    } finally {
      holder.remove();
    }
  };

  /** The payslip this page is showing, if it has already been recorded. */
  const recorded = payroll.find(
    (p) => Number(p.employee_id) === employee.id && p.period === month
  );

  /** Save the payslip as a payroll record.
   *
   *  Downloading a PDF was the only thing this page did, so a payslip existed
   *  as a file and nowhere else: the employee's payroll history stayed empty,
   *  monthly payroll read zero, and the agent's list_payroll saw nothing. */
  const save = async () => {
    if (recorded || saving) return;
    const ok = await confirm({
      title: "Record this payslip?",
      message: `${employee.name} - ${periodLabel}, net ${aed(net)}. This posts the salary to your accounts as an expense paid from cash.`,
      confirmLabel: "Record payslip",
    });
    if (!ok) return;
    setSaving(true);
    try {
      await hr.runPayroll(employee.id, month, basic, allowances, deductions);
      loadPayroll();
      toast.success(`Payslip recorded for ${periodLabel}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the payslip.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={`Payslip - ${employee.name}`}
        subtitle={periodLabel}
        action={
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => nav("/people")}>
              <ArrowLeft size={15} /> Back
            </button>
            <button className="btn-ghost" onClick={() => void download()}>
              <Download size={15} /> Download PDF
            </button>
            <button
              className="btn-primary"
              onClick={save}
              disabled={!!recorded || saving}
              title={
                recorded
                  ? "Already recorded for this month"
                  : "Save this payslip to payroll"
              }
            >
              {recorded ? <Check size={15} /> : <Save size={15} />}
              {recorded ? "Recorded" : saving ? "Recording…" : "Record payslip"}
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left: editor */}
        <div className="space-y-4">
          <div className="card p-5 space-y-4">
            <div>
              <label className="block text-[12px] font-medium text-muted-foreground mb-1">Month</label>
              <input
                type="month"
                className="input"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-muted-foreground mb-1">Basic Salary ({getDisplayCurrency()})</label>
              <input
                type="number"
                className="input"
                value={basic || ""}
                readOnly
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-muted-foreground mb-1">Allowances ({getDisplayCurrency()})</label>
              <input
                type="number"
                className="input"
                value={allowances || ""}
                onChange={(e) => setAllowances(numInput(e.target.value))}
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-muted-foreground mb-1">Deductions ({getDisplayCurrency()})</label>
              <input
                type="number"
                className="input"
                value={deductions || ""}
                onChange={(e) => setDeductions(numInput(e.target.value))}
              />
            </div>
            <div className="border-t border-border pt-3 flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Net Pay</span>
              <span className="text-lg font-semibold text-foreground tabular-nums">{aed(net)}</span>
            </div>
          </div>
        </div>

        {/* Right: live preview */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-[13px] text-muted-foreground mb-3">Preview</div>
          <div ref={ref}>
            <div
              className="invoice-print bg-white text-black rounded-xl border border-brand-200 p-6"
              data-pdf-single="true"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  {company?.logo && (
                    <img src={company.logo} alt="" className="h-10 mb-2 object-contain" />
                  )}
                  <p className="font-semibold text-lg">{company?.name || "Company"}</p>
                  {company?.address && (
                    <p className="text-xs text-gray-500">{company.address}</p>
                  )}
                  {company?.trn && <p className="text-xs text-gray-500">TRN: {company.trn}</p>}
                </div>
                <div className="text-right">
                  <p className="font-semibold tracking-wide">PAYSLIP</p>
                  <p className="text-xs text-gray-500">{periodLabel}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 text-sm border-t border-b border-gray-200 py-3 mb-3">
                <div><span className="text-gray-500">Employee: </span>{employee.name}</div>
                <div><span className="text-gray-500">Code: </span>{employee.employee_code || "—"}</div>
                <div><span className="text-gray-500">Department: </span>{employee.department || "—"}</div>
                <div><span className="text-gray-500">Position: </span>{employee.position || "—"}</div>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b border-gray-100">
                    <td className="py-1.5">Basic Salary</td>
                    <td className="py-1.5 text-right tabular-nums">{aed(basic)}</td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="py-1.5">Allowances</td>
                    <td className="py-1.5 text-right tabular-nums">{aed(allowances)}</td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="py-1.5">Deductions</td>
                    <td className="py-1.5 text-right tabular-nums">{aed(-deductions)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="py-2">Net Pay</td>
                    <td className="py-2 text-right tabular-nums">{aed(net)}</td>
                  </tr>
                </tfoot>
              </table>
              <p className="text-[11px] text-gray-400 mt-6">
                Computer-generated payslip - no signature required.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}