import { useState } from "react";
import {
  LayoutDashboard,
  TrendingUp,
  Boxes,
  Wallet,
  Users,
  Truck,
  Download,
} from "lucide-react";
import { PageHeader, Spinner, ErrorBanner } from "../../components/ui";
import { downloadCsv } from "../../lib/csv";
import { cn, todayYmd } from "../../lib/format";
import { useReportsData } from "./useReportsData";
import DashboardTab from "./DashboardTab";
import SalesTab from "./SalesTab";
import InventoryTab from "./InventoryTab";
import FinancialTab from "./FinancialTab";
import CustomersTab from "./CustomersTab";
import SuppliersTab from "./SuppliersTab";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "sales", label: "Sales", icon: TrendingUp },
  { id: "inventory", label: "Inventory", icon: Boxes },
  { id: "financial", label: "Financial", icon: Wallet },
  { id: "customers", label: "Customers", icon: Users },
  { id: "suppliers", label: "Suppliers", icon: Truck },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function Reports() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const data = useReportsData();

  const exportCsv = () => {
    const rows = [
      { metric: "Revenue", amount: data.invoices.filter((i) => i.status !== "draft").reduce((s, i) => s + (i.total || 0), 0) },
      { metric: "Cash received", amount: data.receiptList.reduce((s, r) => s + (Number(r.amount) || 0), 0) },
      { metric: "Customers", amount: data.customers.length },
      { metric: "Orders", amount: data.orders.length },
      { metric: "Products", amount: data.products.length },
      { metric: "Suppliers", amount: data.supplierList.length },
    ];
    downloadCsv(`filey-report-${todayYmd()}`, rows, [
      { key: "metric", label: "Metric" },
      { key: "amount", label: "Amount" },
    ]);
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Reports"
        subtitle="Live analytics driven by your invoices, receipts, orders and inventory."
        action={
          <button className="btn-ghost" onClick={exportCsv}>
            <Download size={15} /> Export CSV
          </button>
        }
      />

      {data.error && (
        <div className="mb-4">
          <ErrorBanner message={data.error} />
        </div>
      )}
      {data.loading &&
        data.products.length === 0 &&
        data.invoices.length === 0 &&
        !data.error && (
          <div className="card mb-4">
            <Spinner label="Loading reports…" />
          </div>
        )}

      {/* Tab navigation */}
      <div className="flex items-center gap-1 border-b border-border mb-5 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap",
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {tab === "dashboard" && <DashboardTab data={data} />}
      {tab === "sales" && <SalesTab data={data} />}
      {tab === "inventory" && <InventoryTab data={data} />}
      {tab === "financial" && <FinancialTab data={data} />}
      {tab === "customers" && <CustomersTab data={data} />}
      {tab === "suppliers" && <SuppliersTab data={data} />}
    </div>
  );
}