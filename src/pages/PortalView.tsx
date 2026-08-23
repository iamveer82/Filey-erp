import { useEffect, useState } from "react";
import { FileWarning } from "lucide-react";
import { supabase, invokeFn } from "../lib/supabase";
import { money } from "../lib/format";
import DocView, { type DocViewForm, type DocViewLabels } from "../components/DocView";
import { splitItemMeta, docTotals } from "../lib/docItems";
import { applyRoundOff } from "../lib/money";
import { Spinner, EmptyState } from "../components/ui";


/* Public, unauthenticated document viewer for shared links.
 * Route: #/portal/<share_token>
 * Reads through the SECURITY DEFINER get_shared_doc() RPC, which only returns
 * documents the owner has explicitly shared (shared = true). */

interface SharedDoc {
  doc_type: "invoice" | "quotation" | "purchase_order" | "receipt";
  doc: Record<string, unknown>;
  items: { description: string; qty: number; unit_price: number; unit?: string; discount?: number; tax?: number; custom?: Record<string, string> }[];
}

function tokenFromHash(): string {
  const m = window.location.hash.match(/#\/portal\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export default function PortalView() {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [shared, setShared] = useState<SharedDoc | null>(null);
  const [paying, setPaying] = useState(false);
  const [payErr, setPayErr] = useState<string | null>(null);
  const paid = typeof window !== "undefined" && window.location.hash.includes("paid=1");

  useEffect(() => {
    const token = tokenFromHash();
    if (!supabase || !token) {
      setState("error");
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase.rpc("get_shared_doc", { p_token: token });
        if (error || !data) {
          setState("error");
          return;
        }
        setShared(data as SharedDoc);
        setState("ok");
      } catch (e) {
        console.warn("Failed to load shared document", e);
        setState("error");
      }
    })();
  }, []);

  const pay = async () => {
    if (!supabase || !shared || shared.doc_type !== "invoice") return;
    setPaying(true);
    setPayErr(null);
    try {
      const { data, error } = (await invokeFn(supabase, "stripe", {
        body: { action: "pay_invoice", token: tokenFromHash() },
      })) as { data: { url?: string; error?: string } | null; error: { message: string } | null };
      const res = data;
      if (error || !res?.url)
        throw new Error(res?.error || error?.message || "Payment is not available yet.");
      window.location.href = res.url;
    } catch (e) {
      setPayErr(e instanceof Error ? e.message : String(e));
      setPaying(false);
    }
  };

  if (state === "loading")
    return (
      <div className="grid min-h-screen place-items-center bg-muted">
        <Spinner label="Loading document…" />
      </div>
    );

  if (state === "error" || !shared)
    return (
      <div className="grid min-h-screen place-items-center bg-muted px-6">
        <EmptyState
          icon={FileWarning}
          title="Document not available"
          description="This link is invalid or the document is no longer shared."
        />
      </div>
    );

  const d = shared.doc;
  const ccy = String(d.currency || "AED");
  const form: DocViewForm = {
    template: String(d.template || "minimal"),
    accent: String(d.accent || "#222222"),
    currency: ccy,
    doc_title: String(d.doc_title || docTitleFor(shared.doc_type)),
    number: String(d.number || ""),
    logo: d.logo ? String(d.logo) : null,
    seller_name: String(d.seller_name || ""),
    seller_address: d.seller_address ? String(d.seller_address) : null,
    seller_trn: d.seller_trn ? String(d.seller_trn) : null,
    seller_email: d.seller_email ? String(d.seller_email) : null,
    seller_phone: d.seller_phone ? String(d.seller_phone) : null,
    customer_name: String(d.customer_name || ""),
    customer_address: d.customer_address ? String(d.customer_address) : null,
    customer_trn: d.customer_trn ? String(d.customer_trn) : null,
    customer_email: d.customer_email ? String(d.customer_email) : null,
    issue_date: d.issue_date ? String(d.issue_date) : null,
    due_date: d.due_date ? String(d.due_date) : null,
    po_number: d.po_number ? String(d.po_number) : null,
    tax_rate: typeof d.tax_rate === "number" ? d.tax_rate : 0,
    discount: typeof d.discount === "number" ? d.discount : 0,
    notes: d.notes ? String(d.notes) : null,
    terms: d.terms ? String(d.terms) : null,
    // The doc-level formula and round-off drive both the line amounts and the
    // Total the customer is asked to pay, so they have to survive the trip
    // through the share RPC (which returns the whole row) into DocView.
    unit_price_formula:
      (d.unit_price_formula as { a: string; b: string } | null) || null,
    round_off: typeof d.round_off === "boolean" ? d.round_off : false,
    items: shared.items.map((it) => {
      const { custom, calcMode, amount, itemFormula, discount, tax } = splitItemMeta(
        it.custom
      );
      return {
        description: it.description,
        qty: Number(it.qty),
        unit_price: Number(it.unit_price),
        unit: it.unit,
        // Invoices keep the per-line discount in the `custom` meta; quotations
        // keep it in a real column. Dropping the meta side billed the customer
        // for the undiscounted line.
        discount: discount ?? it.discount,
        tax: tax ?? it.tax,
        custom,
        calcMode,
        amount,
        itemFormula,
      };
    }),
  };

  const labels: DocViewLabels = labelsFor(shared.doc_type);
  const status = String(d.status || "draft");
  // Same total DocView renders (net of discounts, with VAT, round-off when
  // enabled) — the Pay label must match the document's Total, not the gross
  // pre-tax subtotal.
  const totals = applyRoundOff(
    docTotals(
      form.items,
      form.discount || 0,
      form.tax_rate || 0,
      form.unit_price_formula
    ),
    !!form.round_off
  );

  return (
    <div className="min-h-screen bg-muted px-4 py-10">
      <div className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-8 text-foreground">
        {(paid || status === "paid") && (
          <div className="mb-4 rounded-xl bg-success/10 px-4 py-2.5 text-sm font-medium text-success">
            Payment received - thank you!
          </div>
        )}

        {/* ponytail: customer-facing invoice stays English regardless of app lang */}
        <div className="paper-texture rounded-xl border border-border p-8 shadow-sm min-h-[1123px]" data-no-i18n dir="ltr">
          <DocView form={form} labels={labels} />
        </div>

        {shared.doc_type === "invoice" && status !== "paid" && !paid && (
          <div className="mt-6 text-center">
            {payErr && <p className="text-sm text-danger mb-2">{payErr}</p>}
            <button
              className="btn-primary"
              disabled={paying}
              onClick={pay}
            >
              {paying ? "Preparing payment…" : `Pay ${money(totals.total, ccy)}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function docTitleFor(type: SharedDoc["doc_type"]): string {
  switch (type) {
    case "quotation":
      return "QUOTATION";
    case "purchase_order":
      return "PURCHASE ORDER";
    case "receipt":
      return "RECEIPT";
    default:
      return "INVOICE";
  }
}

function labelsFor(type: SharedDoc["doc_type"]): DocViewLabels {
  switch (type) {
    case "quotation":
      return { partyLabel: "Quote To", totalLabel: "Total", issuedLabel: "Quote Date", dueLabel: "Valid Until" };
    case "purchase_order":
      return { partyLabel: "Supplier", totalLabel: "Total", issuedLabel: "Order Date", dueLabel: "Expected" };
    case "receipt":
      return { docTitle: "RECEIPT", partyLabel: "Received From", totalLabel: "Amount Received", issuedLabel: "Date", dueLabel: "Date" };
    default:
      return { partyLabel: "Bill To", totalLabel: "Total", issuedLabel: "Issued", dueLabel: "Due" };
  }
}
