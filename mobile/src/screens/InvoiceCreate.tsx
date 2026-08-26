import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { billing, crm, type CrmCustomer } from "@shared/api";
import { pickDocNumber, loadDocFormats } from "@shared/numberFormat";
import { getDisplayCurrency, todayYmd } from "@shared/format";
import { Field, SaveBar, Spinner } from "@mobile/components/ui";

/** Raise an invoice on the phone: customer, lines, tax — saved as a draft the
 *  desktop (or this screen's detail view) can finalise. Numbering follows the
 *  same saved format as everywhere else. */
export default function InvoiceCreate() {
  const nav = useNavigate();
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [number, setNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [customerName, setCustomerName] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [taxRate, setTaxRate] = useState(5);
  const [items, setItems] = useState<{ description: string; qty: string; price: string }[]>([
    { description: "", qty: "1", price: "" },
  ]);

  useEffect(() => {
    Promise.all([
      crm.customers(),
      billing.listDocs("sales").catch(() => [] as { number: string }[]),
      loadDocFormats(),
    ]).then(([c, docs, fmts]) => {
      setCustomers(c);
      setNumber(pickDocNumber("invoice", docs.map((d) => d.number), fmts));
    });
  }, []);

  const setItem = (i: number, patch: Partial<(typeof items)[number]>) =>
    setItems((arr) => arr.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  const save = async () => {
    const lines = items
      .map((it) => ({
        description: it.description.trim(),
        quantity: Number(it.qty) || 0,
        unit_price: Number(it.price) || 0,
      }))
      .filter((it) => it.description);
    if (!customerName.trim()) return setErr("Who is this invoice for?");
    if (!lines.length) return setErr("Add at least one item with a description.");

    setSaving(true);
    setErr(null);
    try {
      const co = await billing.getCompany().catch(() => null);
      const subtotal = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
      const total = subtotal * (1 + (taxRate || 0) / 100);
      await billing.saveDoc({
        number,
        status: "draft",
        doc_title: "Tax Invoice",
        template: co?.default_template || "minimal",
        accent: co?.default_accent || "#FFD600",
        currency: getDisplayCurrency(),
        seller_name: co?.name || "",
        seller_address: co?.address,
        seller_trn: co?.trn,
        seller_email: co?.email,
        seller_phone: co?.phone,
        logo: co?.logo,
        customer_name: customerName.trim(),
        issue_date: date,
        due_date: date,
        tax_rate: taxRate || 0,
        discount: 0,
        total,
        items: lines,
      } as never);
      nav(`/invoices`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div className="screen-in mx-auto w-full max-w-xl px-4 pt-3">
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => nav(-1)}
          aria-label="Back"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted-foreground active:bg-hover"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-[20px] font-semibold tracking-tight text-foreground">
          New invoice
        </h1>
      </div>

      <div className="space-y-4">
        <div className="card space-y-3 p-4">
          <Field label="Invoice number">
            <input className="input" value={number} onChange={(e) => setNumber(e.target.value)} />
          </Field>
          <Field label="Bill to">
            <input
              className="input"
              list="mobile-customers"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Customer name"
            />
            <datalist id="mobile-customers">
              {customers.map((c) => (
                <option key={c.id} value={c.company || c.name} />
              ))}
            </datalist>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input
                className="input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Tax rate %">
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={taxRate}
                onChange={(e) => setTaxRate(Number(e.target.value) || 0)}
              />
            </Field>
          </div>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold text-foreground">Items</p>
            <button
              className="flex items-center gap-1 text-[12.5px] font-medium text-primary-700 dark:text-primary-300"
              style={{ color: "hsl(var(--primary-700))" }}
              onClick={() => setItems((a) => [...a, { description: "", qty: "1", price: "" }])}
            >
              <Plus size={14} /> Add line
            </button>
          </div>
          {items.map((it, i) => (
            <div key={i} className="card space-y-2 p-3">
              <div className="flex items-center gap-2">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                  {i + 1}
                </span>
                <input
                  className="input flex-1"
                  placeholder="Description"
                  value={it.description}
                  onChange={(e) => setItem(i, { description: e.target.value })}
                />
                {items.length > 1 && (
                  <button
                    aria-label="Remove line"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted-foreground active:bg-hover"
                    onClick={() => setItems((a) => a.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  placeholder="Qty"
                  value={it.qty}
                  onChange={(e) => setItem(i, { qty: e.target.value })}
                />
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  placeholder="Rate"
                  value={it.price}
                  onChange={(e) => setItem(i, { price: e.target.value })}
                />
              </div>
            </div>
          ))}
        </div>

        {err && <p className="text-[12.5px] font-medium text-danger">{err}</p>}
        {saving && (
          <div className="flex items-center justify-center gap-2 py-2 text-[13px] text-muted-foreground">
            <Spinner className="h-4 w-4" /> Saving draft…
          </div>
        )}

        <SaveBar onSave={() => void save()} saving={saving} label="Save draft" />
      </div>
    </div>
  );
}
