import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { money, fmtDate } from "../lib/format";

/* Public, unauthenticated invoice viewer for shared links (#23).
 * Opened via #/portal/<share_token>. Reads through the SECURITY DEFINER
 * get_shared_invoice() RPC, which only returns invoices the owner shared. */

interface Item {
  description: string;
  qty: number;
  unit_price: number;
}
interface Doc {
  number: string;
  status: string;
  currency: string;
  seller_name: string;
  seller_address?: string;
  seller_trn?: string;
  seller_email?: string;
  seller_phone?: string;
  customer_name: string;
  customer_address?: string;
  customer_trn?: string;
  issue_date?: string;
  due_date?: string;
  notes?: string;
  terms?: string;
  tax_rate: number;
  discount: number;
}

function tokenFromHash(): string {
  const m = window.location.hash.match(/#\/portal\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export default function PortalView() {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [doc, setDoc] = useState<Doc | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [paying, setPaying] = useState(false);
  const [payErr, setPayErr] = useState<string | null>(null);
  const paid = typeof window !== "undefined" && window.location.hash.includes("paid=1");

  const pay = async () => {
    if (!supabase) return;
    setPaying(true);
    setPayErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("stripe", {
        body: { action: "pay_invoice", token: tokenFromHash() },
      });
      const res = data as { url?: string; error?: string } | null;
      if (error || !res?.url)
        throw new Error(res?.error || error?.message || "Payment is not available yet.");
      window.location.href = res.url;
    } catch (e) {
      setPayErr(e instanceof Error ? e.message : String(e));
      setPaying(false);
    }
  };

  useEffect(() => {
    const token = tokenFromHash();
    if (!supabase || !token) {
      setState("error");
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase.rpc("get_shared_invoice", {
          p_token: token,
        });
        if (error || !data) {
          setState("error");
          return;
        }
        const payload = data as { doc: Doc; items: Item[] };
        setDoc(payload.doc);
        setItems(payload.items ?? []);
        setState("ok");
      } catch (e) {
        console.warn("Failed to load shared invoice", e);
        setState("error");
      }
    })();
  }, []);

  if (state === "loading")
    return (
      <div className="grid min-h-screen place-items-center bg-[#F7F3EA] dark:bg-[#1C1C1E] text-sm font-medium text-brand-500">
        Loading invoice…
      </div>
    );

  if (state === "error" || !doc)
    return (
      <div className="grid min-h-screen place-items-center bg-[#F7F3EA] dark:bg-[#1C1C1E] px-6 text-center">
        <div>
          <p className="text-lg font-medium text-ink">Invoice not available</p>
          <p className="mt-1 text-sm text-brand-500">
            This link is invalid or the invoice is no longer shared.
          </p>
        </div>
      </div>
    );

  const ccy = doc.currency || "AED";
  const subtotal = items.reduce(
    (s, it) => s + (Number(it.qty) || 0) * (Number(it.unit_price) || 0),
    0
  );
  const taxable = Math.max(0, subtotal - (Number(doc.discount) || 0));
  const tax = taxable * ((Number(doc.tax_rate) || 0) / 100);
  const total = taxable + tax;

  return (
    <div className="min-h-screen bg-[#F7F3EA] dark:bg-[#1C1C1E] px-4 py-10">
      <div className="mx-auto max-w-3xl rounded-2xl border border-brand-200 dark:border-[#2C2C2E] bg-white dark:bg-[#1C1C1E] p-8 text-ink dark:text-[#F4F5F6]">
        {(paid || doc.status === "paid") && (
          <div className="mb-4 rounded-2xl bg-green-50 dark:bg-green-500/15 px-4 py-2.5 text-sm font-medium text-green-700 dark:text-green-400">
            Payment received — thank you!
          </div>
        )}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-medium">{doc.seller_name || "Invoice"}</h1>
            {doc.seller_address && (
              <p className="mt-1 whitespace-pre-line text-xs text-brand-500 dark:text-[#B6BAC1]">
                {doc.seller_address}
              </p>
            )}
            {doc.seller_trn && (
              <p className="text-xs text-brand-500 dark:text-[#B6BAC1]">
                TRN: {doc.seller_trn}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-brand-400 dark:text-[#9AA0A8]">Invoice</p>
            <p className="text-lg font-medium">{doc.number}</p>
            <span className="mt-1 inline-block rounded-full bg-brand-100 dark:bg-white/12 px-2.5 py-0.5 text-[11px] font-medium text-brand-500 dark:text-[#DDE0E4]">
              {doc.status}
            </span>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-6 text-sm">
          <div>
            <p className="text-[11px] text-brand-400 dark:text-[#9AA0A8]">Bill to</p>
            <p className="font-medium">{doc.customer_name}</p>
            {doc.customer_address && (
              <p className="whitespace-pre-line text-xs text-brand-500 dark:text-[#B6BAC1]">
                {doc.customer_address}
              </p>
            )}
            {doc.customer_trn && (
              <p className="text-xs text-brand-500 dark:text-[#B6BAC1]">
                TRN: {doc.customer_trn}
              </p>
            )}
          </div>
          <div className="text-right text-xs text-brand-500 dark:text-[#B6BAC1]">
            {doc.issue_date && <p>Issued: {fmtDate(doc.issue_date)}</p>}
            {doc.due_date && <p>Due: {fmtDate(doc.due_date)}</p>}
          </div>
        </div>

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-brand-200 dark:border-[#2C2C2E] text-left text-[11px] text-brand-400 dark:text-[#9AA0A8]">
              <th className="py-2">Description</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Price</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-b border-neutral-100 dark:border-[#2C2C2E]">
                <td className="py-2">{it.description}</td>
                <td className="py-2 text-right tabular-nums">{it.qty}</td>
                <td className="py-2 text-right tabular-nums">
                  {money(it.unit_price, ccy)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {money(it.qty * it.unit_price, ccy)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 ml-auto w-full max-w-xs space-y-1 text-sm">
          <Row k="Subtotal" v={money(subtotal, ccy)} />
          {doc.discount > 0 && <Row k="Discount" v={`- ${money(doc.discount, ccy)}`} />}
          <Row k={`Tax (${doc.tax_rate}%)`} v={money(tax, ccy)} />
          <div className="flex justify-between border-t border-brand-200 dark:border-[#2C2C2E] pt-2 text-base font-medium">
            <span>Total</span>
            <span className="tabular-nums">{money(total, ccy)}</span>
          </div>
        </div>

        {doc.status !== "paid" && !paid && (
          <div className="mt-6 flex flex-col items-end gap-1">
            <button
              onClick={pay}
              disabled={paying}
              className="rounded-2xl bg-[#FFD600] px-5 py-2.5 text-sm font-medium text-[#0A0A0A] transition-[filter] hover:brightness-95 disabled:opacity-60"
            >
              {paying ? "Redirecting…" : `Pay ${money(total, ccy)}`}
            </button>
            {payErr && <p className="text-xs text-red-600 dark:text-red-400">{payErr}</p>}
          </div>
        )}

        {(doc.notes || doc.terms) && (
          <div className="mt-6 space-y-2 border-t border-brand-200 dark:border-[#2C2C2E] pt-4 text-xs text-brand-500 dark:text-[#B6BAC1]">
            {doc.notes && <p className="whitespace-pre-line">{doc.notes}</p>}
            {doc.terms && <p className="whitespace-pre-line">{doc.terms}</p>}
          </div>
        )}

        <p className="mt-8 text-center text-[11px] text-brand-400 dark:text-[#9AA0A8]">
          Powered by Filey
        </p>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-brand-500 dark:text-[#DDE0E4]">
      <span>{k}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
}
