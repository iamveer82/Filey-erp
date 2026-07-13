/* ── SuppliersTab: Top suppliers + payables aging ─────────────────────────── */
import { Truck, ShoppingCart, Clock, DollarSign } from "lucide-react";
import { useMemo } from "react";
import type { ChartConfig } from "../../components/ui/chart";
import { aed, num } from "../../lib/format";
import type { ReportsData } from "./useReportsData";
import { ReportKpi } from "./components/ReportKpi";
import { ReportBarChart } from "./components/ReportChart";
import { ReportTable, StatusBadge, type Column } from "./components/ReportTable";

const chartConfig = {
  value: { label: "Payable", color: "#FFD600" },
} satisfies ChartConfig;

interface SupplierSummary {
  name: string;
  poCount: number;
  totalValue: number;
  received: number;
  pending: number;
}

export function SuppliersTab({ data }: { data: ReportsData }) {
  const { posList, loading } = data;

  /* Aggregate by supplier */
  const suppliers = useMemo<SupplierSummary[]>(() => {
    const m = new Map<string, SupplierSummary>();
    for (const po of posList) {
      if (po.status === "cancelled") continue;
      const name = (po.supplier_name || "—").trim() || "—";
      const cur = m.get(name) ?? {
        name,
        poCount: 0,
        totalValue: 0,
        received: 0,
        pending: 0,
      };
      cur.poCount += 1;
      cur.totalValue += po.total || 0;
      if (po.status === "received") cur.received += po.total || 0;
      else cur.pending += po.total || 0;
      m.set(name, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.totalValue - a.totalValue);
  }, [posList]);

  /* Payables aging buckets (by expected_date) */
  const aging = useMemo(() => {
    const now = new Date();
    const buckets = {
      current: 0,
      "1-30": 0,
      "31-60": 0,
      "61-90": 0,
      "90+": 0,
    };
    for (const po of posList) {
      if (po.status === "cancelled" || po.status === "received") continue;
      const val = po.total || 0;
      if (val <= 0) continue;
      if (!po.expected_date) {
        buckets.current += val;
        continue;
      }
      const due = new Date(po.expected_date);
      const daysOverdue = Math.floor(
        (now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysOverdue <= 0) buckets.current += val;
      else if (daysOverdue <= 30) buckets["1-30"] += val;
      else if (daysOverdue <= 60) buckets["31-60"] += val;
      else if (daysOverdue <= 90) buckets["61-90"] += val;
      else buckets["90+"] += val;
    }
    return buckets;
  }, [posList]);

  const totalValue = suppliers.reduce((s, c) => s + c.totalValue, 0);
  const totalReceived = suppliers.reduce((s, c) => s + c.received, 0);
  const totalPending = suppliers.reduce((s, c) => s + c.pending, 0);

  const supplierColumns: Column<SupplierSummary>[] = [
    {
      key: "sl",
      header: "SL",
      className: "w-8 text-brand-400 px-4",
      render: (_, i) => i + 1,
    },
    {
      key: "name",
      header: "Supplier",
      render: (s) => <span className="font-medium">{s.name}</span>,
    },
    {
      key: "poCount",
      header: "POs",
      align: "right",
      render: (s) => <span className="tabular-nums">{num(s.poCount)}</span>,
    },
    {
      key: "totalValue",
      header: "Total Value",
      align: "right",
      render: (s) => <span className="tabular-nums">{aed(s.totalValue)}</span>,
    },
    {
      key: "received",
      header: "Received",
      align: "right",
      render: (s) => (
        <span className="tabular-nums text-success">{aed(s.received)}</span>
      ),
    },
    {
      key: "pending",
      header: "Pending",
      align: "right",
      render: (s) => (
        <span
          className={s.pending > 0 ? "font-medium tabular-nums text-warning" : "tabular-nums text-brand-400"}
        >
          {aed(s.pending)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (s) => (
        <StatusBadge tone={s.pending === 0 ? "paid" : "open"}>
          {s.pending === 0 ? "Fulfilled" : "Pending"}
        </StatusBadge>
      ),
    },
  ];

  const agingData = [
    { name: "Current", value: aging.current },
    { name: "1–30", value: aging["1-30"] },
    { name: "31–60", value: aging["31-60"] },
    { name: "61–90", value: aging["61-90"] },
    { name: "90+", value: aging["90+"] },
  ];

  return (
    <div className="space-y-6">
      {/* ── KPI cards ── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <ReportKpi
          label="Total PO Value"
          value={aed(totalValue)}
          icon={<DollarSign size={20} />}
          iconClass="bg-primary-100 text-ink"
          change={`${num(suppliers.length)} suppliers`}
          changeTone="up"
          loading={loading}
        />
        <ReportKpi
          label="Received"
          value={aed(totalReceived)}
          icon={<Truck size={20} />}
          iconClass="bg-success/15 text-success"
          change="Into stock"
          changeTone="up"
          loading={loading}
        />
        <ReportKpi
          label="Pending"
          value={aed(totalPending)}
          icon={<Clock size={20} />}
          iconClass="bg-warning/15 text-warning"
          change="Awaiting delivery"
          changeTone={totalPending > 0 ? "warn" : "up"}
          loading={loading}
        />
        <ReportKpi
          label="Total POs"
          value={num(posList.filter((p) => p.status !== "cancelled").length)}
          icon={<ShoppingCart size={20} />}
          iconClass="bg-info/15 text-info"
          change="Non-cancelled"
          changeTone="up"
          loading={loading}
        />
      </section>

      {/* ── Payables aging chart ── */}
      <ReportBarChart
        data={agingData.map((d) => ({ name: d.name, value: d.value }))}
        config={chartConfig}
        title="Payables aging"
        loading={loading}
      />

      {/* ── Top suppliers table ── */}
      <ReportTable
        title="Top suppliers by PO value"
        subtitle={`${num(suppliers.length)} suppliers · ${aed(totalValue)} total · ${aed(totalPending)} pending`}
        columns={supplierColumns}
        rows={suppliers}
        emptyMessage="No supplier transactions"
        footer={
          <>
            <td colSpan={5} className="py-2.5 px-4 text-right text-sm">
              Grand Total
            </td>
            <td className="py-2.5 px-2 text-right tabular-nums">{aed(totalPending)}</td>
            <td></td>
          </>
        }
      />
    </div>
  );
}