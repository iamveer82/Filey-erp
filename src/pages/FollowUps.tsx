import { useEffect, useState } from "react";
import { AlarmClock, CalendarClock, Users, Truck } from "lucide-react";
import { PageHeader } from "../components/ui";
import StatStrip from "../components/StatStrip";
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
  const stats = [
    {
      label: "Overdue",
      value: num(open.filter((f) => f.due_date < today).length),
      icon: <AlarmClock size={16} />,
    },
    {
      label: "Due today",
      value: num(open.filter((f) => f.due_date === today).length),
      icon: <CalendarClock size={16} />,
    },
    {
      label: "Open · customers",
      value: num(open.filter((f) => f.supplier_id == null).length),
      icon: <Users size={16} />,
    },
    {
      label: "Open · suppliers",
      value: num(open.filter((f) => f.supplier_id != null).length),
      icon: <Truck size={16} />,
    },
  ];

  const customerOpts = customers.map((c) => ({
    id: c.id,
    name: c.name,
    company: c.company,
  }));
  const supplierOpts = vendors.map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Follow-ups"
        subtitle="Reminders and to-dos — we surface them in-app when they're due"
      />

      <StatStrip className="mb-6" items={stats} />

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
