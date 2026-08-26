import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Share2, FileText } from "lucide-react";
import { billing, type InvoiceDoc } from "@shared/api";
import { money, fmtDate } from "@shared/format";
import { Card, Pill, Loading, EmptyState } from "@mobile/components/ui";

export default function InvoiceDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [doc, setDoc] = useState<InvoiceDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    billing
      .getDoc(Number(id))
      .then(setDoc)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Loading />;
  if (err || !doc)
    return (
      <div className="px-4 pt-16">
        <EmptyState
          icon={<FileText size={22} />}
          title="Invoice not found"
          hint={err ?? undefined}
        />
      </div>
    );

  const ccy = doc.currency || "AED";
  const subtotal = doc.items.reduce(
    (s, it) => s + (Number(it.qty) || 0) * (Number(it.unit_price) || 0),
    0
  );
  const tax = ((doc.tax_rate || 0) / 100) * subtotal;
  const total = Math.round((subtotal + tax) * 100) / 100;

  const setStatus = async (status: string) => {
    try {
      await billing.setStatus(doc.id, status);
      setDoc((d) => (d ? { ...d, status } : d));
    } catch {
      /* silent — the list will show the real state on refresh */
    }
  };

  const share = async () => {
    const text = `Invoice ${doc.number} — ${money(total, ccy)}${
      doc.customer_name ? ` · ${doc.customer_name}` : ""
    } (${doc.status})`;
    try {
      if (navigator.share) await navigator.share({ title: doc.number, text });
      else await navigator.clipboard.writeText(text);
    } catch {
      /* user dismissed */
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
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[20px] font-semibold tracking-tight text-foreground">
            {doc.number}
          </h1>
          <p className="text-[12px] text-muted-foreground">
            {doc.issue_date ? fmtDate(doc.issue_date) : ""}
          </p>
        </div>
        <button
          onClick={() => void share()}
          aria-label="Share"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-card text-foreground active:bg-hover"
        >
          <Share2 size={18} />
        </button>
      </div>

      <div className="space-y-3">
        <Card className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-[11.5px] text-muted-foreground">Billed to</p>
            <p className="truncate text-[15px] font-medium text-foreground">
              {doc.customer_name || "—"}
            </p>
            {doc.customer_trn && (
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                TRN {doc.customer_trn}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Pill status={doc.status} />
            {doc.status === "draft" && (
              <button
                onClick={() => void setStatus("sent")}
                className="rounded-full border border-border px-2.5 py-0.5 text-[10.5px] font-medium text-muted-foreground transition-colors active:bg-hover"
              >
                Mark sent
              </button>
            )}
            {doc.status === "sent" && (
              <button
                onClick={() => void setStatus("paid")}
                className="rounded-full border border-success/30 px-2.5 py-0.5 text-[10.5px] font-medium text-success transition-colors active:bg-success/10"
              >
                Mark paid
              </button>
            )}
          </div>
        </Card>

        <Card>
          <p className="mb-2 text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
            Items
          </p>
          <div className="divide-y divide-border">
            {doc.items.map((it, i) => (
              <div key={i} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[13.5px] text-foreground">{it.description || "—"}</p>
                  <p className="mt-0.5 text-[11.5px] tabular-nums text-muted-foreground">
                    {it.qty} × {money(Number(it.unit_price) || 0, ccy)}
                    {it.unit ? ` · ${it.unit}` : ""}
                  </p>
                </div>
                <p className="shrink-0 text-[13.5px] font-medium tabular-nums text-foreground">
                  {money((Number(it.qty) || 0) * (Number(it.unit_price) || 0), ccy)}
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="space-y-1.5">
          <Row label="Subtotal" value={money(subtotal, ccy)} />
          {(doc.tax_rate || 0) > 0 && (
            <Row label={`Tax (${doc.tax_rate}%)`} value={money(tax, ccy)} />
          )}
          <div className="border-t border-border pt-2">
            <Row label="Total" value={money(total, ccy)} strong />
          </div>
        </Card>

        {doc.notes && (
          <Card>
            <p className="text-[12px] leading-relaxed text-muted-foreground">{doc.notes}</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span
        className={
          strong ? "text-[14px] font-semibold text-foreground" : "text-[13px] text-muted-foreground"
        }
      >
        {label}
      </span>
      <span
        className={
          strong
            ? "text-[16px] font-semibold tabular-nums text-foreground"
            : "text-[13px] tabular-nums text-foreground"
        }
      >
        {value}
      </span>
    </div>
  );
}
