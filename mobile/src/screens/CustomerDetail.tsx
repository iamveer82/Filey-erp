import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Mail, Phone, FileText, BadgeCheck, Users } from "lucide-react";
import { billing, crm, type CrmCustomer, type InvoiceDocSummary } from "@shared/api";
import { aed } from "@shared/format";
import { Card, ListRow, Loading, EmptyState } from "@mobile/components/ui";

export default function CustomerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [customer, setCustomer] = useState<CrmCustomer | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDocSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([crm.customers(), billing.listDocs("sales")])
      .then(([cs, docs]) => {
        setCustomer(cs.find((c) => String(c.id) === id) ?? null);
        setInvoices(docs);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const theirs = useMemo(
    () =>
      invoices.filter(
        (d) =>
          d.customer_name &&
          customer &&
          (d.customer_name === customer.name || d.customer_name === customer.company)
      ),
    [invoices, customer]
  );
  const billed = theirs.reduce((s, d) => s + (d.total || 0), 0);
  const owed = theirs.reduce((s, d) => s + (d.balance ?? 0), 0);

  if (loading) return <Loading />;
  if (!customer)
    return (
      <div className="px-4 pt-16">
        <EmptyState icon={<Users size={22} />} title="Customer not found" />
      </div>
    );

  const displayName = customer.company || customer.name;

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
        <h1 className="truncate text-[20px] font-semibold tracking-tight text-foreground">
          {displayName}
        </h1>
      </div>

      <div className="space-y-3">
        <Card className="space-y-2">
          {customer.name && customer.company && (
            <Info icon={<span className="text-[12px] font-semibold">C</span>} text={customer.name} />
          )}
          {customer.phone && <Info icon={<Phone size={14} />} text={customer.phone} />}
          {customer.email && <Info icon={<Mail size={14} />} text={customer.email} />}
          {customer.trn && <Info icon={<BadgeCheck size={14} />} text={`TRN ${customer.trn}`} />}
          {customer.segment && (
            <Info icon={<span className="text-[12px] font-semibold">S</span>} text={customer.segment} />
          )}
        </Card>

        <div className="grid grid-cols-2 gap-2.5">
          <Card className="!p-3.5">
            <p className="text-[11.5px] text-muted-foreground">Billed</p>
            <p className="mt-1 text-[18px] font-semibold tabular-nums text-foreground">
              {aed(billed)}
            </p>
          </Card>
          <Card className="!p-3.5">
            <p className="text-[11.5px] text-muted-foreground">Outstanding</p>
            <p className="mt-1 text-[18px] font-semibold tabular-nums text-foreground">
              {aed(owed)}
            </p>
          </Card>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-foreground">Invoices</h2>
            <span className="text-[12px] text-muted-foreground">{theirs.length}</span>
          </div>
          {theirs.length === 0 ? (
            <EmptyState
              icon={<FileText size={22} />}
              title="No invoices for this customer yet"
            />
          ) : (
            <div className="space-y-2">
              {theirs.slice(0, 20).map((d) => (
                <ListRow
                  key={d.id}
                  title={d.number}
                  subtitle={d.issue_date || ""}
                  amount={aed(d.total || 0)}
                  status={d.status}
                  onClick={() => nav(`/invoices/${d.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Info({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2.5 text-[13.5px] text-foreground">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </span>
      <span className="truncate">{text}</span>
    </div>
  );
}
