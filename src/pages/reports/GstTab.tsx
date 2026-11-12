import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Download, FileJson, RefreshCw, Upload } from "lucide-react";
import { billing, type CompanyProfile, type InvoiceDocSummary } from "../../lib/api";
import { downloadCsv } from "../../lib/csv";
import { downloadText } from "../../lib/localPaths";
import { money, todayYmd } from "../../lib/format";
import { gstinError } from "../../lib/gst";
import { buildGstr1, buildGstr3b, compositionTax, countsForGst, gstr1Json, quarterMonths, summarizeGstDoc, taxOf, type GstAmounts, type GstDocSummary } from "../../lib/gstReturns";
import { matchGstr2b, parseGstr2b, type Gstr2bMatch } from "../../lib/gstr2b";
import { isTdsMethod } from "../../lib/tds";
import { loadIndiaRegistration, type IndiaRegistration } from "../../components/IndiaRegistrationFields";
import { ErrorBanner, Spinner } from "../../components/ui";
import { toast } from "../../components/Toaster";

const inr = (v: number) => money(v, "INR");

/** Fetch saved documents a few at a time: a month can hold hundreds of invoices. */
async function docsFor(list: InvoiceDocSummary[], month: string | string[]) {
  const months = Array.isArray(month) ? month : [month];
  const picked = list.filter((d) => months.some((m) => (d.issue_date ?? "").startsWith(m)) && countsForGst(d.status));
  const out = [];
  for (let i = 0; i < picked.length; i += 6) out.push(...await Promise.all(picked.slice(i, i + 6).map((d) => billing.getDoc(d.id))));
  return out;
}

function Table({ title, note, head, rows, onCsv }: { title: string; note?: string; head: string[]; rows: ReactNode[][]; onCsv?: () => void }) {
  return <section className="mb-6">
    <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
      <div><h3 className="text-sm font-semibold text-foreground">{title} <span className="font-normal text-muted-foreground">· {rows.length}</span></h3>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}</div>
      {onCsv && rows.length > 0 && <button type="button" className="btn-ghost" onClick={onCsv}><Download size={14} /> CSV</button>}
    </div>
    {rows.length === 0 ? <p className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">Nothing in this section for the month.</p> :
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            {head.map((h, i) => <th key={h} className={`px-3 py-2 font-medium ${i >= head.length - 5 ? "text-right" : ""}`}>{h}</th>)}
          </tr></thead>
          <tbody>{rows.map((row, r) => <tr key={r} className="border-b border-border last:border-0">
            {row.map((cell, i) => <td key={i} className={`px-3 py-2 text-ink ${i >= row.length - 5 ? "text-right tabular-nums" : ""}`}>{cell}</td>)}
          </tr>)}</tbody>
        </table>
      </div>}
  </section>;
}

const money5 = (a: GstAmounts) => [inr(a.taxable), inr(a.igst), inr(a.cgst), inr(a.sgst), inr(taxOf(a))];
const sum = (docs: GstDocSummary[]) => docs.reduce((t, d) => d.rates.reduce((s, r) => ({
  taxable: s.taxable + r.taxable, igst: s.igst + r.igst, cgst: s.cgst + r.cgst, sgst: s.sgst + r.sgst }), t), { taxable: 0, igst: 0, cgst: 0, sgst: 0 });
const docRow = (d: GstDocSummary) => ({ number: d.number, date: d.date, party: d.party, gstin: d.gstin, place_of_supply: d.pos, value: d.value, ...sum([d]) });

/** GSTR-1 and GSTR-3B for one month, built from saved invoices and purchase invoices. */
export default function GstTab({ company }: { company: CompanyProfile }) {
  const [month, setMonth] = useState(() => todayYmd().slice(0, 7));
  const [data, setData] = useState<{ sales: GstDocSummary[]; purchases: GstDocSummary[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const own = { country_subdivision: company.country_subdivision, trn: company.trn };
  const [reg, setReg] = useState<IndiaRegistration | null>(null);
  const [tds, setTds] = useState<{ number: string; party: string; date: string; section: string; amount: number; purchase: boolean }[]>([]);
  useEffect(() => { loadIndiaRegistration().then(setReg).catch(() => setReg({})); }, []);
  const composition = reg?.gst_scheme === "composition";
  const quarter = composition ? quarterMonths(month) : [month];

  const load = useCallback(async () => {
    if (!/^\d{4}-\d{2}$/.test(month) || !reg) return;
    setLoading(true);
    setError("");
    try {
      const [sales, purchases] = await Promise.all([billing.listDocs("sales", true), billing.listDocs("purchase", true)]);
      const [saleDocs, purchaseDocs, payments] = await Promise.all([docsFor(sales, composition ? quarterMonths(month) : month), composition ? [] : docsFor(purchases, month), billing.allPayments().catch(() => [])]);
      const byId = new Map<number, { d: InvoiceDocSummary; purchase: boolean }>([...sales.map((d) => [d.id, { d, purchase: false }] as [number, { d: InvoiceDocSummary; purchase: boolean }]), ...purchases.map((d) => [d.id, { d, purchase: true }] as [number, { d: InvoiceDocSummary; purchase: boolean }])]);
      setTds(payments.filter((p) => isTdsMethod(p.method) && (p.paid_at ?? "").startsWith(month) && byId.has(p.invoice_id)).map((p) => {
        const { d, purchase } = byId.get(p.invoice_id)!;
        return { number: d.number, party: d.customer_name, date: p.paid_at, section: (p.method ?? "").replace(/^TDS\s*/, "") || "—", amount: Number(p.amount), purchase };
      }));
      setData({
        sales: saleDocs.map((d) => summarizeGstDoc(d, own)),
        purchases: purchaseDocs.map((d) => summarizeGstDoc(d, own, true)),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invoices could not be read.");
    } finally {
      setLoading(false);
    }
    // own is derived from company, which is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, company.country_subdivision, company.trn, reg, composition]);
  useEffect(() => { void load(); }, [load]);

  const r1 = useMemo(() => data && buildGstr1(data.sales), [data]);
  const r3b = useMemo(() => data && buildGstr3b(data.sales, data.purchases), [data]);
  const gstin = (company.trn ?? "").trim().toUpperCase();
  const setupProblems = [
    !company.country_subdivision?.trim() && "Your business state is not set.",
    !gstin ? "Your GSTIN is not set." : gstinError(gstin) && `Your GSTIN: ${gstinError(gstin)}`,
  ].filter(Boolean) as string[];

  const csv = (name: string, rows: Record<string, unknown>[]) =>
    downloadCsv(`gst-${name}-${month}`, rows).catch((e) => toast.error(e instanceof Error ? e.message : "Could not export CSV."));
  const json = () => {
    if (!r1) return;
    downloadText(`GSTR1_${gstin || "GSTIN"}_${month.slice(5)}${month.slice(0, 4)}.json`, JSON.stringify(gstr1Json(r1, gstin, month), null, 2), "application/json")
      .then(() => toast.success("GSTR-1 JSON saved. Open it in the GST offline tool and check it before uploading."))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not save the JSON."));
  };

  const [recon, setRecon] = useState<{ file: string; period: string; result: Gstr2bMatch } | null>(null);
  const [reconBusy, setReconBusy] = useState(false);
  const reconcile = async (file: File) => {
    setReconBusy(true);
    try {
      let raw: unknown;
      try { raw = JSON.parse(await file.text()); } catch { throw new Error("This file is not JSON. Download the GSTR-2B JSON from the GST portal."); }
      const parsed = parseGstr2b(raw);
      if (parsed.gstin && gstin && parsed.gstin !== gstin) throw new Error(`This GSTR-2B is for ${parsed.gstin}, not your GSTIN ${gstin}.`);
      const period = parsed.period || month;
      const [y, m] = period.split("-").map(Number);
      // Suppliers file late, so bills from the two months before can show up in this statement.
      const months = [2, 1, 0].map((back) => { const d = new Date(y, m - 1 - back, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
      const books = (await docsFor(await billing.listDocs("purchase", true), months)).map((d) => summarizeGstDoc(d, own, true));
      const result = matchGstr2b(parsed.docs, books);
      // Earlier months' bills belong to earlier statements: only this period's count as missing.
      result.missingInPortal = result.missingInPortal.filter((d) => d.date.startsWith(period));
      setRecon({ file: file.name, period, result });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the GSTR-2B file.");
    } finally {
      setReconBusy(false);
    }
  };
  const portalTax = (p: { igst: number; cgst: number; sgst: number }) => inr(p.igst + p.cgst + p.sgst);
  const cmp = composition && data ? compositionTax(data.sales, Number(reg?.composition_rate) || 1) : null;

  return <div>
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <label htmlFor="gst-month" className="label">Return period</label>
        <input id="gst-month" type="month" className="input w-44" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost" disabled={loading} onClick={() => { void load(); }}><RefreshCw size={14} /> Refresh</button>
        {!composition && <button type="button" className="btn-primary" disabled={loading || !r1 || !gstin} onClick={json} title={gstin ? "B2B, B2C, credit notes and HSN summary" : "Set your GSTIN first"}><FileJson size={14} /> GSTR-1 JSON</button>}
      </div>
    </div>
    <p className="mb-4 max-w-3xl text-xs text-muted-foreground">{composition
      ? `Composition scheme: built from the bills of supply dated ${quarter[0]} to ${quarter[2]}, drafts and cancelled ones left out. Check the figures with your CA before you file CMP-08.`
      : "Built from invoices and purchase invoices dated in this month, drafts and cancelled ones left out. Check the figures with your CA or in the GST offline tool before you file."}</p>
    {setupProblems.length > 0 && <div role="alert" className="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
      {setupProblems.join(" ")} <Link className="underline" to="/settings?section=company">Open Company details</Link> so the tax splits correctly.
    </div>}
    {error && <div className="mb-4"><ErrorBanner message={error} /></div>}
    {loading && <div className="py-10"><Spinner label="Reading this month's invoices…" /></div>}
    {!loading && cmp && data && <>
      <h2 className="mb-3 text-base font-semibold">CMP-08 for the quarter</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-4">
        {[["Turnover", inr(cmp.turnover)], [`Tax at ${Number(reg?.composition_rate) || 1}%`, inr(cmp.tax)], ["CGST", inr(cmp.cgst)], ["SGST / UTGST", inr(cmp.sgst)]].map(([k, v]) =>
          <div key={k}><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</p><p className="text-lg font-semibold tabular-nums text-foreground">{v}</p></div>)}
      </div>
      <Table title="Bills of supply" note="Credit notes reduce the turnover; exports are left out." head={["Bill", "Date", "Customer", "Value"]}
        rows={data.sales.map((d) => [d.number, d.date, d.party, inr(d.credit ? -d.value : d.value)])}
        onCsv={() => csv("cmp08", data.sales.map((d) => ({ number: d.number, date: d.date, customer: d.party, value: d.credit ? -d.value : d.value })))} />
      <p className="text-xs text-muted-foreground">Composition dealers file GSTR-4 once a year and cannot claim input tax credit.</p>
    </>}
    {!loading && !composition && r1 && r3b && data && <>
      <div className="mb-6 grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-4">
        {[["Taxable value", inr(r3b.outward.taxable + r3b.zeroRated.taxable)], ["Output tax", inr(taxOf(r3b.outward) + taxOf(r3b.zeroRated))],
          ["Input tax credit", inr(taxOf(r3b.itc))], ["Payable in cash", inr(r3b.payable.igst + r3b.payable.cgst + r3b.payable.sgst)]].map(([k, v]) =>
          <div key={k}><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</p><p className="text-lg font-semibold tabular-nums text-foreground">{v}</p></div>)}
      </div>

      {r1.problems.length > 0 && <details className="mb-6 rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm">
        <summary className="cursor-pointer font-medium"><AlertTriangle size={14} className="mr-1 inline" />{r1.problems.length} thing{r1.problems.length === 1 ? "" : "s"} to fix before filing</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">{r1.problems.slice(0, 100).map((p, i) => <li key={i}><span className="font-medium text-ink">{p.number}</span>: {p.problem}</li>)}</ul>
      </details>}

      <h2 className="mb-3 text-base font-semibold">GSTR-3B</h2>
      <Table title="Summary" head={["Section", "Taxable", "IGST", "CGST", "SGST", "Tax"]} rows={[
        ["3.1(a) Outward taxable supplies", ...money5(r3b.outward)],
        ["3.1(b) Zero-rated (exports)", ...money5(r3b.zeroRated)],
        ["3.1(c) Nil-rated and exempt", inr(r3b.nil), "—", "—", "—", "—"],
        ["4(A)(5) Input tax credit", ...money5(r3b.itc)],
        ["Payable in cash", "—", inr(r3b.payable.igst), inr(r3b.payable.cgst), inr(r3b.payable.sgst), inr(r3b.payable.igst + r3b.payable.cgst + r3b.payable.sgst)],
      ]} onCsv={() => csv("3b", [
        { section: "3.1(a)", ...r3b.outward }, { section: "3.1(b)", ...r3b.zeroRated }, { section: "3.1(c)", taxable: r3b.nil },
        { section: "4(A)(5)", ...r3b.itc }, { section: "payable", ...r3b.payable },
      ])} />

      <h2 className="mb-3 mt-8 text-base font-semibold">GSTR-1</h2>
      <Table title="B2B invoices" note="Buyers with a GSTIN." head={["Invoice", "Date", "Buyer", "GSTIN", "Taxable", "IGST", "CGST", "SGST", "Tax"]}
        rows={r1.b2b.map((d) => [d.number, d.date, d.party, d.gstin, ...money5(sum([d]))])} onCsv={() => csv("b2b", r1.b2b.map(docRow))} />
      <Table title="B2C large" note="Unregistered buyers in another state, invoice above Rs 1,00,000." head={["Invoice", "Date", "Buyer", "Place of supply", "Taxable", "IGST", "CGST", "SGST", "Tax"]}
        rows={r1.b2cl.map((d) => [d.number, d.date, d.party, d.pos, ...money5(sum([d]))])} onCsv={() => csv("b2cl", r1.b2cl.map(docRow))} />
      <Table title="B2C small" note="Other unregistered sales, by place of supply and rate." head={["Type", "Place of supply", "Rate", "Taxable", "IGST", "CGST", "SGST", "Tax"]}
        rows={r1.b2cs.map((row) => [row.type === "INTRA" ? "Within state" : "Other state", row.pos || "—", `${row.rate}%`, ...money5(row.amounts)])}
        onCsv={() => csv("b2cs", r1.b2cs.map((row) => ({ type: row.type, place_of_supply: row.pos, rate: row.rate, ...row.amounts })))} />
      <Table title="Exports" note="Buyers outside India." head={["Invoice", "Date", "Buyer", "Value", "Taxable", "IGST", "CGST", "SGST", "Tax"]}
        rows={r1.exports.map((d) => [d.number, d.date, d.party, inr(d.value), ...money5(sum([d]))])} onCsv={() => csv("exports", r1.exports.map(docRow))} />
      <Table title="Credit notes" note="CDNR for registered buyers, CDNUR for the rest." head={["Note", "Date", "Buyer", "GSTIN", "Taxable", "IGST", "CGST", "SGST", "Tax"]}
        rows={[...r1.cdnr, ...r1.cdnur].map((d) => [d.number, d.date, d.party, d.gstin || "Unregistered", ...money5(sum([d]))])}
        onCsv={() => csv("credit-notes", [...r1.cdnr, ...r1.cdnur].map(docRow))} />
      <Table title="HSN summary" note="Credit notes are netted off." head={["HSN/SAC", "Description", "UQC", "Qty", "Rate", "Taxable", "IGST", "CGST", "SGST", "Tax"]}
        rows={r1.hsn.map((l) => [l.hsn || "Missing", l.description, l.uqc, l.qty, `${l.rate}%`, ...money5(l.amounts)])}
        onCsv={() => csv("hsn", r1.hsn.map((l) => ({ hsn: l.hsn, description: l.description, uqc: l.uqc, qty: l.qty, rate: l.rate, ...l.amounts })))} />
      <p className="text-xs text-muted-foreground">Purchase invoices read for input tax credit: {data.purchases.length}. Sales documents: {data.sales.length}.</p>
    </>}
    {!loading && data && <section className="mt-10">
      <h2 className="mb-3 text-base font-semibold">TDS for the month</h2>
      <Table title="Kept back by customers" note="Claim these against income tax; check them in Form 26AS." head={["Invoice", "Customer", "Paid", "Section", "TDS"]}
        rows={tds.filter((r) => !r.purchase).map((r) => [r.number, r.party, r.date, r.section, inr(r.amount)])}
        onCsv={() => csv("tds-received", tds.filter((r) => !r.purchase))} />
      <Table title="Kept back from suppliers" note="Deposit by the 7th of next month and file the quarterly TDS return." head={["Bill", "Supplier", "Paid", "Section", "TDS"]}
        rows={tds.filter((r) => r.purchase).map((r) => [r.number, r.party, r.date, r.section, inr(r.amount)])}
        onCsv={() => csv("tds-deducted", tds.filter((r) => r.purchase))} />
    </section>}
    {reg && !composition && <section className="mt-10">
      <h2 className="mb-1 text-base font-semibold">GSTR-2B matching</h2>
      <p className="mb-3 max-w-3xl text-xs text-muted-foreground">Download the GSTR-2B JSON from the GST portal (Returns → GSTR-2B) and open it here. Each supplier invoice is matched to your purchase invoices by GSTIN and invoice number, and the amounts are compared.</p>
      <label className="btn-ghost inline-flex cursor-pointer items-center gap-1.5">
        <Upload size={14} /> {reconBusy ? "Matching…" : "Open GSTR-2B JSON"}
        <input type="file" accept=".json,application/json" className="sr-only" aria-label="GSTR-2B JSON file" disabled={reconBusy}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void reconcile(f); }} />
      </label>
      {recon && <div className="mt-4">
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-4">
          {[["Matched", recon.result.matched.length], ["Amounts differ", recon.result.mismatched.length], ["Not in Filey", recon.result.missingInBooks.length], ["Not on the portal", recon.result.missingInPortal.length]].map(([k, v]) =>
            <div key={k}><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</p><p className="text-lg font-semibold tabular-nums text-foreground">{v}</p></div>)}
        </div>
        <p className="mb-4 text-xs text-muted-foreground">{recon.file} · period {recon.period}</p>
        <Table title="Amounts differ" note="Same invoice on both sides with different figures. Check the bill with the supplier." head={["Supplier", "Invoice", "Date", "Portal taxable", "Filey taxable", "Portal tax", "Filey tax", "Difference"]}
          rows={recon.result.mismatched.map((p) => [p.portal.name || p.books.party, p.portal.number, p.portal.date, inr(p.portal.taxable), inr(p.portal.taxable + p.taxableDiff), portalTax(p.portal), inr(p.portal.igst + p.portal.cgst + p.portal.sgst + p.taxDiff), inr(p.taxableDiff + p.taxDiff)])}
          onCsv={() => csv("2b-differ", recon.result.mismatched.map((p) => ({ supplier: p.portal.name, gstin: p.portal.gstin, invoice: p.portal.number, date: p.portal.date, portal_taxable: p.portal.taxable, taxable_difference: p.taxableDiff, portal_tax: p.portal.igst + p.portal.cgst + p.portal.sgst, tax_difference: p.taxDiff })))} />
        <Table title="On the portal, not in Filey" note="Record these purchases, or ask the supplier why they are there." head={["Supplier", "GSTIN", "Invoice", "Date", "Taxable", "IGST", "CGST", "SGST", "Tax"]}
          rows={recon.result.missingInBooks.map((p) => [p.name, p.gstin, `${p.number}${p.note ? ` (${p.note === "C" ? "credit" : "debit"} note)` : ""}`, p.date, inr(p.taxable), inr(p.igst), inr(p.cgst), inr(p.sgst), portalTax(p)])}
          onCsv={() => csv("2b-not-in-filey", recon.result.missingInBooks.map((p) => ({ ...p })))} />
        <Table title="In Filey, not on the portal" note="The supplier has not filed these yet, so the input tax credit is at risk. Follow up before claiming it." head={["Invoice", "Date", "Supplier", "GSTIN", "Taxable", "IGST", "CGST", "SGST", "Tax"]}
          rows={recon.result.missingInPortal.map((d) => [d.number, d.date, d.party, d.gstin || "Missing", ...money5(sum([d]))])}
          onCsv={() => csv("2b-not-on-portal", recon.result.missingInPortal.map(docRow))} />
        <Table title="Matched" head={["Supplier", "GSTIN", "Invoice", "Date", "Taxable", "IGST", "CGST", "SGST", "Tax"]}
          rows={recon.result.matched.map(({ portal: p }) => [p.name, p.gstin, p.number, p.date, inr(p.taxable), inr(p.igst), inr(p.cgst), inr(p.sgst), portalTax(p)])}
          onCsv={() => csv("2b-matched", recon.result.matched.map(({ portal: p }) => ({ ...p })))} />
      </div>}
    </section>}
  </div>;
}
