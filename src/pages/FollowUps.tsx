import { useEffect, useState } from "react";
import { PageHeader, MetricCard } from "../components/ui";
import FollowUps from "../components/FollowUps";
import StickyNotes from "../components/StickyNotes";
import {
  crm,
  suppliers as supplierApi,
  followups,
  type CrmCustomer,
  type Supplier,
  type FollowUp,
} from "../lib/api";
import { useUI } from "../lib/ui";
import { useLiveSync } from "../lib/realtime";
import { num, todayYmd } from "../lib/format";

export default function FollowUpsPage() {
  const { toast } = useUI();
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [vendors, setVendors] = useState<Supplier[]>([]);
  const [items, setItems] = useState<FollowUp[]>([]);

  const load = () =>
    Promise.all([crm.customers(), supplierApi.list(), followups.list()])
      .then(([c, s, f]) => {
        setCustomers(c);
        setVendors(s);
        setItems(f);
      })
      .catch((e) =>
        toast.error("Failed to load follow-ups: " + (e instanceof Error ? e.message : e))
      );
  useEffect(() => {
    load();
  }, []);
  useLiveSync(load);

  // The dashboard counts both sides together; the sections below split them.
  // Same rule as the boards: a row with no supplier_id is customer-side, which
  // is where unlinked reminders land too.
  const today = todayYmd();
  const open = items.filter((f) => !f.done);
  const overdue = open.filter((f) => f.due_date < today).length;
  const dueToday = open.filter((f) => f.due_date === today).length;
  const openCustomers = open.filter((f) => f.supplier_id == null).length;
  const openSuppliers = open.filter((f) => f.supplier_id != null).length;

  const customerOpts = customers.map((c) => ({
    id: c.id,
    name: c.name,
    company: c.company,
  }));
  const supplierOpts = vendors.map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="">
      <PageHeader
        title="Follow-ups"
        subtitle="Reminders and to-dos. We surface them in-app when they're due"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 joined-kpis mb-6">
        <MetricCard
          label="Overdue"
          value={num(overdue)}
          change={overdue > 0 ? "Past due date" : "None"}
          changeTone={overdue > 0 ? "down" : "up"}
        />
        <MetricCard
          label="Due today"
          value={num(dueToday)}
          change={dueToday > 0 ? "Needs attention" : "Nothing due"}
          changeTone={dueToday > 0 ? "warn" : "up"}
        />
        <MetricCard
          label="Open · customers"
          value={num(openCustomers)}
          change="Customer reminders"
          changeTone="up"
        />
        <MetricCard
          label="Open · suppliers"
          value={num(openSuppliers)}
          change="Supplier reminders"
          changeTone="up"
        />
      </div>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-bold text-ink">Customers</h2>
        <FollowUps
          party="customer"
          parties={customerOpts}
          heading="Customer follow-ups"
        />
        <div className="mt-4">
          <StickyNotes scope="followups:customer" title="Customer notes" />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold text-ink">Suppliers</h2>
        <FollowUps
          party="supplier"
          parties={supplierOpts}
          heading="Supplier follow-ups"
        />
        <div className="mt-4">
          <StickyNotes scope="followups:supplier" title="Supplier notes" />
        </div>
      </section>
    </div>
  );
}
