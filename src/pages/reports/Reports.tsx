import { toast } from "../../components/Toaster";
import { useSearchParams } from "react-router-dom";
import { LayoutDashboard, TrendingUp, Boxes, Wallet, Users, Truck, Download, ChartNoAxesCombined, RefreshCw } from "lucide-react";
import { PageHeader, Spinner, ErrorBanner } from "../../components/ui";
import { downloadCsv } from "../../lib/csv";
import { cn, todayYmd } from "../../lib/format";
import { REPORT_EXPORT_LABELS, reportExportRows } from "./reportExports";
import { useDisplayCurrency } from "../../lib/displayCurrency";
import { useReportsData } from "./useReportsData";
import DashboardTab from "./DashboardTab";
import SalesTab from "./SalesTab";
import InventoryTab from "./InventoryTab";
import FinancialTab from "./FinancialTab";
import CustomersTab from "./CustomersTab";
import SuppliersTab from "./SuppliersTab";
import InsightsTab from "./InsightsTab";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "sales", label: "Sales", icon: TrendingUp },
  { id: "inventory", label: "Inventory", icon: Boxes },
  { id: "financial", label: "Financial", icon: Wallet },
  { id: "customers", label: "Customers", icon: Users },
  { id: "suppliers", label: "Suppliers", icon: Truck },
  { id: "insights", label: "Insights", icon: ChartNoAxesCombined },
] as const;

type TabId = (typeof TABS)[number]["id"];

function FinancialReports({ tab }: { tab: Exclude<TabId, "insights"> }) {
  const data = useReportsData();
  const { currency } = useDisplayCurrency();
  const rows = reportExportRows(tab,data,todayYmd());
  const exportCsv = () => {
    downloadCsv(`filey-${tab}-${todayYmd()}`,rows).catch(error => toast.error(error instanceof Error ? error.message : "Could not export CSV."));
  };
  return <>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="max-w-3xl text-xs text-muted-foreground">Amounts are displayed in {currency} from totals normalized to AED using saved document rates where available. CSV exports use AED. Invoice payments and independently recorded receipt documents are shown separately; adding them can double-count the same payment. Receipt documents include confirmed receipts only.</p>
      <div className="flex shrink-0 gap-2">
        <button className="btn-ghost" disabled={data.loading} onClick={data.reload}><RefreshCw size={14} /> Refresh</button>
        <button className="btn-ghost" disabled={data.loading || !!data.error || !rows.length} onClick={exportCsv}><Download size={14} /> {REPORT_EXPORT_LABELS[tab]}</button>
      </div>
    </div>
    {data.error && <div className="mb-4"><ErrorBanner message={data.error} /></div>}
    {data.loading ? <div className="py-10"><Spinner label="Loading reports…" /></div> : data.error ? null : <>
      {tab === "dashboard" && <DashboardTab data={data} />}
      {tab === "sales" && <SalesTab data={data} />}
      {tab === "inventory" && <InventoryTab data={data} />}
      {tab === "financial" && <FinancialTab data={data} />}
      {tab === "customers" && <CustomersTab data={data} />}
      {tab === "suppliers" && <SuppliersTab data={data} />}
    </>}
  </>;
}

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.find(item => item.id === params.get("tab"))?.id || "dashboard";
  return <div>
    <PageHeader title="Reports" subtitle="Business reports and section insights, connected to your active workspace." />
    <nav aria-label="Report sections" className="mb-5 flex flex-wrap gap-2">
      {TABS.map(item => {
        const Icon = item.icon;
        return <button key={item.id} aria-pressed={tab === item.id} className={cn("chip", tab === item.id && "chip-active")} onClick={() => {
          const next = new URLSearchParams(params);
          next.set("tab", item.id);
          if (item.id !== "insights") next.delete("section");
          setParams(next);
        }}><Icon size={14} /> {item.label}</button>;
      })}
    </nav>
    {tab === "insights" ? <InsightsTab /> : <FinancialReports tab={tab} />}
  </div>;
}
