import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  User,
  PackageCheck,
  Wallet,
  ClipboardList,
  BadgeCheck,
  Pencil,
  Save,
  X,
} from "lucide-react";
import {
  suppliers as suppliersApi,
  pos,
  type Supplier,
  type PoSummary,
} from "../lib/api";
import { PageHeader, StatCard, DataTable, Badge, statusTone } from "../components/ui";
import { aed, num, fmtDate } from "../lib/format";
import { useUI } from "../lib/ui";
import ActivityTimeline from "../components/ActivityTimeline";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="text-sm font-medium text-ink mb-2">{title}</h2>
      {children}
    </section>
  );
}

export default function SupplierDetail() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PoSummary[]>([]);
  const { toast } = useUI();

  useEffect(() => {
    let alive = true;
    Promise.all([suppliersApi.list(), pos.list()])
      .then(([ss, ps]) => {
        if (!alive) return;
        setList(ss);
        setOrders(ps);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const supplier = useMemo(() => list.find((s) => String(s.id) === id), [list, id]);

  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  useEffect(() => {
    if (supplier) setNotesDraft(supplier.notes || "");
  }, [supplier?.id]);

  const saveNotes = async () => {
    if (!supplier || !id) return;
    setSavingNotes(true);
    try {
      await suppliersApi.update(Number(id), { notes: notesDraft || undefined });
      // Update local state
      setList((prev) =>
        prev.map((s) => (s.id === Number(id) ? { ...s, notes: notesDraft } : s))
      );
      setEditingNotes(false);
      toast.success("Notes saved.");
    } catch (e) {
      toast.error("Failed to save notes.");
    } finally {
      setSavingNotes(false);
    }
  };

  const myOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          (supplier != null && o.supplier_id === supplier.id) ||
          (supplier != null && o.supplier_name === supplier.name)
      ),
    [orders, supplier]
  );

  const totalValue = myOrders.reduce((s, o) => s + o.total, 0);
  const openCount = myOrders.filter(
    (o) => !["received", "cancelled"].includes(o.status.toLowerCase())
  ).length;
  const receivedCount = myOrders.filter(
    (o) => o.status.toLowerCase() === "received"
  ).length;
  const receivedValue = myOrders
    .filter((o) => o.status.toLowerCase() === "received")
    .reduce((s, o) => s + o.total, 0);

  if (!loading && !supplier) {
    return (
      <div className="animate-fade-up">
        <Link to="/suppliers" className="btn-ghost h-9 inline-flex mb-6">
          <ArrowLeft size={15} /> Back to Suppliers
        </Link>
        <div className="card text-center py-16">
          <p className="text-lg font-medium text-ink">Supplier not found</p>
          <p className="text-sm text-brand-500 mt-2">
            This supplier may have been removed.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <Link to="/suppliers" className="btn-ghost h-9 inline-flex mb-4">
        <ArrowLeft size={15} /> Back to Suppliers
      </Link>
      <PageHeader
        title={supplier?.name || "Supplier"}
        subtitle={supplier?.contact_person || "Supplier profile & purchasing"}
        action={supplier?.shared ? <Badge tone="info">Shared</Badge> : undefined}
      />

      <div className="grid lg:grid-cols-4 gap-4 mb-5">
        {/* Sticky contact card */}
        <div className="lg:col-span-1">
          <div className="card lg:sticky lg:top-4 space-y-4">
            <div>
              <p className="stat-label mb-3">Contact</p>
              <ul className="space-y-2.5 text-sm">
                {supplier?.contact_person && (
                  <li className="flex items-center gap-2.5 text-brand-700 dark:text-[#DDE0E4]">
                    <User size={15} className="text-brand-400 shrink-0" />
                    <span className="truncate">{supplier.contact_person}</span>
                  </li>
                )}
                {supplier?.tax_id && (
                  <li className="flex items-center gap-2.5 text-brand-700 dark:text-[#DDE0E4]">
                    <BadgeCheck size={15} className="text-brand-400 shrink-0" />
                    <span className="font-mono text-xs truncate">{supplier.tax_id}</span>
                  </li>
                )}
                <li className="flex items-center gap-2.5 text-brand-700 dark:text-[#DDE0E4]">
                  <Mail size={15} className="text-brand-400 shrink-0" />
                  <span className="truncate">{supplier?.email || "—"}</span>
                </li>
                <li className="flex items-center gap-2.5 text-brand-700 dark:text-[#DDE0E4]">
                  <Phone size={15} className="text-brand-400 shrink-0" />
                  <span className="truncate">{supplier?.phone || "—"}</span>
                </li>
                <li className="flex items-start gap-2.5 text-brand-700 dark:text-[#DDE0E4]">
                  <MapPin size={15} className="text-brand-400 shrink-0 mt-0.5" />
                  <span>{supplier?.address || "—"}</span>
                </li>
              </ul>
            </div>

            {/* Notes */}
            <div className="border-t border-brand-100 dark:border-[#2C2C2E] pt-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-brand-400">Notes</p>
                {!editingNotes && (
                  <button
                    className="text-brand-400 hover:text-ink p-0.5 rounded cursor-pointer"
                    onClick={() => {
                      setNotesDraft(supplier?.notes || "");
                      setEditingNotes(true);
                    }}
                  >
                    <Pencil size={12} />
                  </button>
                )}
              </div>
              {editingNotes ? (
                <div className="space-y-2">
                  <textarea
                    className="textarea text-xs"
                    rows={4}
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    placeholder="Add notes about this supplier..."
                  />
                  <div className="flex gap-1.5">
                    <button
                      className="btn-primary text-xs !py-1 !px-2.5"
                      disabled={savingNotes}
                      onClick={saveNotes}
                    >
                      <Save size={11} /> {savingNotes ? "..." : "Save"}
                    </button>
                    <button
                      className="btn-ghost text-xs !py-1 !px-2.5"
                      onClick={() => setEditingNotes(false)}
                    >
                      <X size={11} /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-brand-500 whitespace-pre-line">
                  {supplier?.notes || "No notes yet."}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Stat cards */}
        <div className="lg:col-span-3 grid sm:grid-cols-3 gap-4">
          <StatCard
            label="Total ordered"
            value={aed(totalValue)}
            hint={`${myOrders.length} PO${myOrders.length === 1 ? "" : "s"}`}
            icon={<Wallet size={18} />}
          />
          <StatCard
            label="Received"
            value={aed(receivedValue)}
            hint={`${receivedCount} PO${receivedCount === 1 ? "" : "s"} received`}
            icon={<PackageCheck size={18} />}
          />
          <StatCard
            label="Open POs"
            value={num(openCount)}
            hint={openCount > 0 ? "Awaiting receipt" : "All received"}
            icon={<ClipboardList size={18} />}
          />
        </div>
      </div>

      {/* Activity Timeline */}
      {supplier && (
        <Section title="Activity timeline">
          <div className="flex h-[440px] flex-col">
            <ActivityTimeline relatedTo={supplier.name} />
          </div>
        </Section>
      )}

      {/* Purchase orders */}
      <Section title="Purchase orders">
        <DataTable<PoSummary>
          rows={myOrders}
          loading={loading}
          empty="No purchase orders for this supplier"
          columns={[
            {
              key: "number",
              label: "PO #",
              sortValue: (o) => o.po_number,
              render: (o) => (
                <span className="font-mono text-xs font-medium text-ink">
                  {o.po_number}
                </span>
              ),
            },
            {
              key: "ordered",
              label: "Ordered",
              sortValue: (o) => o.order_date ?? "",
              render: (o) => fmtDate(o.order_date),
            },
            {
              key: "expected",
              label: "Expected",
              sortValue: (o) => o.expected_date ?? "",
              render: (o) => fmtDate(o.expected_date),
            },
            {
              key: "status",
              label: "Status",
              sortValue: (o) => o.status,
              render: (o) => <Badge tone={statusTone(o.status)}>{o.status}</Badge>,
            },
            {
              key: "total",
              label: "Total",
              sortValue: (o) => o.total,
              render: (o) => aed(o.total),
            },
          ]}
        />
      </Section>
    </div>
  );
}
